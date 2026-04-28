---
title: "计算机网络-ARP 在 Linux 内核中的实现"
date: 2026-04-28
categories:
  - 计算机网络
---

> 内核用的5.15

## 一、核心结论

ARP 并不关心一个 IPv4 地址是公网还是私网。从 Linux 内核实现看，只要某个 IPv4 地址被内核视为以下三类对象之一，它就可能出现在 ARP 协议里：

1. 本链路可直达的邻居地址. (局域网同网段)
2. 本机拥有的本地地址. (回复别人)
3. 本机愿意代理应答的地址. (arp代理)

最核心的源码结论可以压缩成两句话：

1. `ARP target IP = neigh->primary_key`
2. `neigh->primary_key = 路由下一跳(gateway) 或 最终目的地址(daddr)`

因此：

- 正常"经网关访问公网"时，ARP 解析对象是**网关 IP**，不是公网目的 IP
- 只有当路由结果是 `on-link/direct` 时，公网目的 IP 才会直接出现在 ARP 请求的目标字段里

---

## 二、关键代码链路

### 2.1 ARP 请求发给谁

`net/core/neighbour.c:1118` — 邻居项不可达时，`__neigh_event_send()` 把状态转成 `NUD_INCOMPLETE`，然后调用 `neigh_probe()`。

`net/core/neighbour.c:1013` — `neigh_probe()` 最终调用协议相关的 `solicit()`。

`net/ipv4/arp.c:332` — ARP 的 `solicit()` 是 `arp_solicit()`：

```c
__be32 target = *(__be32 *)neigh->primary_key;
arp_send_dst(... target ...);
```

`net/ipv4/arp.c:523` — `arp_create()` 把传入的 `dest_ip` 直接拷入 ARP payload 的目标 IP 字段。

**结论**：抓包里 ARP 请求的目标 IP 是谁，完全由邻居项主键决定。

### 2.2 邻居项主键来自网关还是最终目的地址

`net/ipv4/route.c:434` — `ipv4_neigh_lookup()` 的逻辑：

```c
if (likely(rt->rt_gw_family == AF_INET))
    n = ip_neigh_gw4(dev, rt->rt_gw4);   // 有网关：ARP 网关
else {
    pkey = ip_hdr(skb)->daddr;            // 无网关：ARP 目的 IP 本身
    n = ip_neigh_gw4(dev, pkey);
}
```

`net/ipv4/route.c:1601` — 只有当路由项真的是带网关的下一跳时，`rt_set_nexthop()` 才会设置 `rt->rt_uses_gateway = 1` 和 `rt->rt_gw4 = gateway`。

因此，正常默认路由 `default via 192.0.2.1 dev eth0` 访问 `8.8.8.8` 时，邻居解析对象是 `192.0.2.1`，而不是 `8.8.8.8`。

---

## 三、公网 IP 出现在 ARP 中的典型场景

### 3.1 接口本身就在公网二层网段中

如果网卡直接配置了公网前缀：

```text
eth0 = 203.0.113.10/24
```

那么 `203.0.113.0/24` 会被内核当作直连前缀，该前缀内的其他公网主机都可能直接进入 ARP 解析。

`net/ipv4/fib_frontend.c:1127` — 在地址添加后，会为接口前缀自动补一条 `RTN_UNICAST` 路由。只要该前缀不是纯 `/32`，这个前缀就是 link-scope 直连网络。

典型场景：ISP 直接下发公网子网到以太网接口、数据中心二层网络里同 VLAN 的公网服务器互访。

### 3.2 显式配置了直连 host route 或 link-scope 路由

即使接口本身不在该公网前缀，只要显式配置成"本链路直达"，它也会直接出现在 ARP 请求里：

```bash
ip route add 8.8.8.8/32 dev eth0
```

`net/ipv4/fib_semantics.c:1212` — 对于"不带网关"的 nexthop，`fib_check_nh_nongw()` 会把 `fib_nh_scope` 设为 `RT_SCOPE_LINK`，后续路由输出时没有网关，邻居查找自然落到最终目的地址 `8.8.8.8` 上。

### 3.3 应用使用 `SO_DONTROUTE` / `MSG_DONTROUTE`

这是"明明有默认路由，却仍然直接 ARP 某个公网目的 IP"的重要内核路径。

`net/ipv4/udp.c:1187`、`net/ipv4/ping.c:776`、`net/ipv4/raw.c:605` — 在以下条件成立时会设置 `RTO_ONLINK`：

- `SOCK_LOCALROUTE`
- `MSG_DONTROUTE`
- 严格源路由

`net/ipv4/route.c:2661` — 如果指定了 `oif` 或 socket 绑定了接口，而普通查表又没有返回可用的 gateway route，代码会走 fallback：

```c
// 假定目标在本链路上
res->type = RTN_UNICAST;
goto make_route;
```

效果：路由对象不再使用网关，邻居项主键变成最终目的公网 IP，ARP 直接对公网目的 IP 发起。

### 3.4 本机自己就拥有这个公网 IP

**正常应答**：`net/ipv4/arp.c:815` — ARP 请求进入 `arp_process()` 后，如果 `tip` 被路由判定为 `RTN_LOCAL`，内核就会发 ARP reply。

**Gratuitous ARP**：`net/ipv4/devinet.c:1505` — `inetdev_send_gratuitous_arp()` 在以下事件下触发：

- `NETDEV_UP`
- `NETDEV_CHANGEADDR`
- `NETDEV_NOTIFY_PEERS`

### 3.5 Proxy ARP 或静态代理 ARP

`net/ipv4/arp.c:838` — 在 `arp_process()` 中，如果接口开启了转发、目标地址是 `RTN_UNICAST`、命中 `arp_fwd_proxy()` 等条件，内核会代为发送 ARP reply。

`net/ipv4/arp.c:1001` — 用户态通过 `SIOCSARP` 携带 `ATF_PUBL` 可配置静态公开代理项。

---

## 四、哪些情况不会直接 ARP 公网目的 IP

### 4.1 普通默认路由经网关访问公网

```text
default via 192.0.2.1 dev eth0
```

访问 `8.8.8.8` 时，依据 `net/ipv4/route.c:434` 与 `include/net/route.h:85`，邻居解析对象是 `192.0.2.1`，不是 `8.8.8.8`。

抓到 `who-has 8.8.8.8` 不能用"只是访问公网"来解释，必然额外命中了直连、on-link、host route 或 localroute 语义。

### 4.2 接口只配置了 `/32` 公网地址

`net/ipv4/fib_frontend.c:1127` — 只有在 `prefix != addr` 或 `ifa_prefixlen < 32` 时，内核才会自动给接口补前缀直连路由。

```text
eth0 = 203.0.113.10/32
```

`203.0.113.10` 本身会出现在 ARP reply/GARP 中，但不会因为这个 `/32` 就自动把其他公网地址当成二层邻居去 ARP。

---

## 五、案例分析：reject 路由 + 绑定网卡导致 ARP 公网 IP

### 5.1 问题描述

为防止流量偷跑，添加了高优先级 reject 默认路由：

```bash
ip route add default reject metric 1
```

**现象**：不绑定网卡时 `ping 8.8.8.8` 正常失败；绑定网卡后 `ping -I wlan0 8.8.8.8` 不返回错误，但也无法通信，抓包发现局域网内出现 `who-has 8.8.8.8` 的 ARP 请求。

**一句话总结**：`-I wlan0` 告诉内核"从这张卡发"，但内核把这句话理解成了"就算路由表不行，也要强行发"。reject 路由把正常的网关信息否掉了，内核没有网关，就拿目的 IP 本身去 ARP。

### 5.2 内核代码链路分析

**第一步**：`-I wlan0` 做了什么（`net/ipv4/ping.c:791`）

```c
flowi4_init_output(&fl4, ipc.oif, ...);  // 把 wlan0 的接口编号写进 fl4
```

**第二步**：路由查找（`net/ipv4/route.c:2661`）

```c
err = fib_lookup(net, fl4, res, 0);
if (err) {
    if (fl4->flowi4_oif && ...) {
        /*
         * Apparently, routing tables are wrong. Assume,
         * that the destination is on link.
         * --ANK
         */
        res->type = RTN_UNICAST;
        goto make_route;   // 跳过错误，强行造路由，且没有网关！
    }
}
```

- `reject default metric 1` → `fib_lookup` 返回 `-EHOSTUNREACH`
- `if (err)` 成立，`oif` 有值 → 进入 fallback 分支
- `goto make_route` 造出的路由对象里**没有网关**（`rt_gw_family = 0`）

**第三步**：邻居解析（`net/ipv4/route.c:434`）

```c
// rt_gw_family == 0，没有网关，走这里：
pkey = ip_hdr(skb)->daddr;   // 直接拿目的 IP = 8.8.8.8
n = ip_neigh_gw4(dev, pkey);
```

**第四步**：ARP 发出（`net/ipv4/arp.c:337`）

```c
__be32 target = *(__be32 *)neigh->primary_key;  // = 8.8.8.8
// → 局域网广播：who-has 8.8.8.8？
```

ARP 是局域网协议，`8.8.8.8` 是公网 IP，局域网内没有设备会回应，包永远发不出去。

### 5.3 完整问题链路

```
ping -I wlan0 8.8.8.8
        │
        ▼
ping.c:791  把 wlan0 的 oif 写进 fl4
        │
        ▼
route.c:2661  fib_lookup() 查路由表
        │
        ▼
命中 reject default metric 1 → 返回 -EHOSTUNREACH
        │
        ▼
route.c:2662  err != 0 且 oif 有值（wlan0）
        │
        ▼  ← 1990年代遗留的 fallback
"假设目标直连" res->type = RTN_UNICAST → goto make_route（无网关信息）
        │
        ▼
route.c:434  ipv4_neigh_lookup()
没有网关 → ARP 目标 = 8.8.8.8（目的 IP 本身）
        │
        ▼
arp.c:337  arp_solicit()
在 wlan0 上广播：who-has 8.8.8.8？
        │
        ▼
局域网无响应 → 包发不出去
```

### 5.4 为什么这个 fallback 存在

代码注释里 ANK（Alexey Kuznetsov，上古内核开发者）的原始意图：

> "就算路由表是错的/空的，只要用户指定了接口，就假设目标是直连的，直接发过去。"

这在 1990 年代是合理的（处理没有路由的裸接口），但遇到"路由表有明确 reject"的场景时，变成了缺陷。

---
