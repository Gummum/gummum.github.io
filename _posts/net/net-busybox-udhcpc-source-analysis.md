---
title: "BusyBox udhcpc 源码分析"
date: 2026-04-28
categories:
  - 计算机网络
---

最近遇到有关`wifi`+`ip`+`dns`的问题,了解到udhcpc是入口.于是把源码拉出来分析了一下.

`udhcpc` 的核心可以先理解成一句话：它是一个事件驱动的 DHCP 客户端进程，内部维护 DHCP 状态机，通过 raw socket 或 UDP socket 收发 DHCP 包，拿到租约后把服务端下发的配置转成环境变量，再调用外部脚本真正配置网卡、路由和 DNS。

## 1. 代码分布

主要文件：

| 文件 | 角色 |
| --- | --- |
| `networking/udhcp/dhcpc.c` | `udhcpc` 主体：命令行解析、状态机、收发包调度、脚本回调 |
| `networking/udhcp/dhcpc.h` | `client_data_t`，保存客户端运行时状态 |
| `pnetworking/udhcp/common.h` | DHCP 包结构、option 编号、共享函数声明 |
| `networking/udhcp/common.c` | DHCP option 表、option 扫描/拼接/字符串转换 |
| `networking/udhcp/packet.c` | DHCP 包初始化、raw packet 发送、kernel UDP packet 发送/接收 |
| `networking/udhcp/socket.c` | 读取接口信息、创建监听 UDP socket |
| `networking/udhcp/signalpipe.c` | 把信号转成 pipe 事件，供主循环 `poll()` 统一处理 |
| `networking/udhcp/arpping.c` | 可选地址冲突检测，`FEATURE_UDHCPC_ARPING` 打开时使用 |
| `examples/udhcp/simple.script` | 示例脚本：根据环境变量配置 IP、默认路由、DNS |

构建关系在 `networking/udhcp/Kbuild.src`：打开 `CONFIG_UDHCPC` 后会编进 `common.o`、`packet.o`、`signalpipe.o`、`socket.o` 和 `dhcpc.o`；打开 ARP 检测后额外编进 `arpping.o`。入口 applet 定义在 `networking/udhcp/dhcpc.c:20`，对象声明在 `networking/udhcp/dhcpc.c:22`。

配置入口在 `networking/udhcp/Config.src:68`：`UDHCPC` 是面向嵌入式系统的 DHCP client。默认接口由 `UDHCPC_DEFAULT_INTERFACE` 控制，默认是 `eth0`；默认脚本由 `UDHCPC_DEFAULT_SCRIPT` 控制，默认是 `/usr/share/udhcpc/default.script`，见 `networking/udhcp/Config.src:99`。

## 2. 总体架构

可以把 `udhcpc` 分成四层：

```text
命令行 / ifupdown
        |
        v
udhcpc_main()
  - 初始化 client_data
  - 解析 -i/-s/-p/-r/-O/-x/-q/-n/-R 等参数
  - 建立 signal pipe
  - 进入主事件循环
        |
        v
DHCP 状态机
  INIT_SELECTING -> REQUESTING -> BOUND -> RENEWING -> REBINDING
        |              |           |          |             |
        v              v           v          v             v
  DISCOVER         REQUEST      script      unicast       broadcast
  raw broadcast    raw bcast    bound       renew         renew
        |
        v
协议与 socket 层
  - common.c/common.h: DHCP 包和 option 解析
  - packet.c: raw/kernel packet 收发
  - socket.c: 接口信息和监听 socket
        |
        v
外部脚本
  deconfig / leasefail / bound / renew / nak
  用环境变量配置地址、路由、DNS
```

注意：`udhcpc` 自己并不直接执行 `ip addr add`、`route add` 或写 `resolv.conf`。它只负责 DHCP 协议协商；系统配置动作交给 `-s PROG` 指定的脚本完成。`examples/udhcp/simple.script:17` 之后就是典型脚本事件分发。

## 3. 核心数据结构

`struct client_data_t` 是整个客户端的运行时上下文，定义在 `networking/udhcp/dhcpc.h:10`：

| 字段 | 含义 |
| --- | --- |
| `client_mac[6]` | 本机接口 MAC，用于 `chaddr` 和默认 client-id |
| `ifindex` | 接口 index，raw socket 发包要用 |
| `xid` | DHCP transaction id，用来过滤不属于自己的回应 |
| `opt_mask` | `-O` 和默认请求 option 的 bitmask |
| `interface` | 网卡名，默认来自 `CONFIG_UDHCPC_DEFAULT_INTERFACE` |
| `pidfile` | `-p` 指定的 pidfile |
| `script` | `-s` 指定的事件脚本 |
| `options` | 要发给服务端的 DHCP options，主要来自 `-x`、vendor、client-id |
| `envp` | 传给脚本的环境变量临时链表 |
| `first_secs/last_secs` | 填 DHCP `secs` 字段，用于记录协商持续时间 |
| `sockfd` | 当前监听 socket |
| `listen_mode` | 当前监听模式：none、kernel UDP、raw |
| `state` | DHCP 状态机状态 |

为了节省嵌入式场景下的数据段，`client_data` 不是普通全局变量，而是映射到 BusyBox 共享 buffer 的后半段，见 `networking/udhcp/dhcpc.h:31`。

DHCP 报文结构是 `struct dhcp_packet`，定义在 `networking/udhcp/common.h:33`。它基本对应 BOOTP/DHCP 报文：`op/htype/hlen/xid/secs/flags/ciaddr/yiaddr/siaddr/giaddr/chaddr/sname/file/cookie/options`。`options` 的大小是 `DHCP_OPTIONS_BUFSIZE + CONFIG_UDHCPC_SLACK_FOR_BUGGY_SERVERS`，用于兼容一些发送超长 option 区域的 DHCP server。

## 4. 启动阶段

入口函数是 `udhcpc_main()`，在 `networking/udhcp/dhcpc.c:1198`。

启动时的关键步骤：

1. 调用 `setup_common_bufsiz()` 初始化 BusyBox 共享 buffer。
2. 设置默认值：服务端端口 67、客户端端口 68、默认接口、默认脚本、默认 vendor 字符串，见 `networking/udhcp/dhcpc.c:1220`。
3. 调用 `udhcp_sp_setup()` 建立 signal pipe，见 `networking/udhcp/dhcpc.c:1230` 和 `networking/udhcp/signalpipe.c:37`。
4. 用 `getopt32long()` 解析命令行，选项声明在 `networking/udhcp/dhcpc.c:55` 和 `networking/udhcp/dhcpc.c:1235`。
5. 处理用户传入的 DHCP options：`-O` 写入 `opt_mask`，`-x` 经过 `udhcp_str2optset()` 转成二进制 option 链表，见 `networking/udhcp/dhcpc.c:1286` 和 `networking/udhcp/common.c:566`。
6. 如果没有 `-C` 且用户没有自定义 client-id，就默认生成 ethernet client-id，见 `networking/udhcp/dhcpc.c:1320`。
7. 调用 `udhcp_read_interface()` 读取接口 index 和 MAC，见 `networking/udhcp/dhcpc.c:1334` 和 `networking/udhcp/socket.c:28`。
8. 写 pidfile、打印启动日志、初始化状态为 `INIT_SELECTING`，并先执行一次 `deconfig` 脚本，见 `networking/udhcp/dhcpc.c:1354`。

启动完成后，代码进入 `for (;;) { ... }` 主循环，见 `networking/udhcp/dhcpc.c:1367`。

## 5. 主事件循环

主循环用 `poll()` 同时等待两类事件：

| 事件 | 来源 | 处理方式 |
| --- | --- | --- |
| 信号事件 | `signalpipe.c` 的 fd 3 | `SIGUSR1` 续租、`SIGUSR2` 释放、`SIGTERM` 退出 |
| 网络包事件 | 当前 `client_data.sockfd` | 按当前 listen mode 选择 raw 或 kernel UDP 接收 |
| 超时事件 | `poll()` timeout | 根据当前 DHCP state 主动发包或状态跳转 |

`udhcp_sp_fd_set()` 把 signal pipe 和可选网络 socket 放进 `pollfd[2]`，见 `networking/udhcp/signalpipe.c:68`。信号处理器不直接改状态，只把信号号写入 pipe，主循环再通过 `udhcp_sp_read()` 读取，这样避免在异步 signal handler 里做复杂逻辑。

超时是状态机前进的主要驱动力。例如初始状态超时会发送 `DHCPDISCOVER`，`BOUND` 超时会进入 `RENEWING`，`RENEWING` 超时可能进入 `REBINDING`。

## 6. DHCP 状态机

状态定义在 `networking/udhcp/dhcpc.c:981`：

| 状态 | 含义 |
| --- | --- |
| `INIT_SELECTING` | 初始或重新开始协商 |
| `REQUESTING` | 已收到 `DHCPOFFER`，正在请求这个租约 |
| `BOUND` | 已拿到租约，等待半个 lease 时间后续租 |
| `RENEWING` | 租约过半，向原 server 单播续租 |
| `REBINDING` | 单播续租失败，租约快结束，广播续租 |
| `RENEW_REQUESTED` | 用户通过 `SIGUSR1` 手动请求续租 |
| `RELEASED` | 用户通过 `SIGUSR2` 或退出释放租约 |

主路径如下：

```text
INIT_SELECTING
  send_discover()
  recv DHCPOFFER
      |
      v
REQUESTING
  send_select()
  recv DHCPACK
      |
      v
BOUND
  run script "bound"
  wait lease_remaining / 2
      |
      v
RENEWING
  send_renew(server_id, requested_ip)
  recv DHCPACK -> run script "renew" -> BOUND
  no response and lease almost expired
      |
      v
REBINDING
  send_renew(0, requested_ip) as broadcast
  recv DHCPACK -> run script "renew" -> BOUND
  lease expired
      |
      v
INIT_SELECTING
  run script "deconfig"
```

### INIT_SELECTING

第一次进入或丢失租约后进入。代码在 `networking/udhcp/dhcpc.c:1433`。

动作：

- 第一次发包前切到 `LISTEN_RAW`，因为此时本机还没有 IP，需要接收广播回应。
- 生成新的 `xid`。
- 调用 `send_discover(requested_ip)` 广播 `DHCPDISCOVER`。
- 等待 `discover_timeout` 秒，默认 3 秒。
- 超过重试次数后执行 `leasefail` 脚本，再根据 `-b`、`-n`、`-A` 决定后台等待、退出或稍后重试。

收到 `DHCPOFFER` 后，代码读取 `DHCP_SERVER_ID` 和 `yiaddr`，保存为 `server_id` 与 `requested_ip`，然后进入 `REQUESTING`，见 `networking/udhcp/dhcpc.c:1651`。

### REQUESTING

代码在 `networking/udhcp/dhcpc.c:1472`。

动作：

- 调用 `send_select(server_id, requested_ip)` 广播 `DHCPREQUEST`。
- 这个包包含 `DHCP_REQUESTED_IP` 和 `DHCP_SERVER_ID`，表示“我选择这个 server 提供的这个地址”。
- 最多重试 3 次，超时后回到 `INIT_SELECTING` 的失败流程。

收到 `DHCPACK` 后进入租约生效流程；收到 `DHCPNAK` 后执行 `nak` 脚本，必要时 `deconfig`，然后回到 `INIT_SELECTING`，见 `networking/udhcp/dhcpc.c:1799`。

### BOUND

收到 `DHCPACK` 后先关闭监听 socket，读取租约时间 option 51，默认 1 小时。此时地址还没有真正交给脚本配置，`udhcpc` 还有机会做最后检查。

如果编译时打开 `FEATURE_UDHCPC_ARPING`，并且运行时带了 `-a[MSEC]`，`udhcpc` 会在执行 `bound/renew` 脚本前调用 `arpping()` 检测服务端给的 `yiaddr` 是否已经被同一二层网络里的其他主机占用，见 `networking/udhcp/dhcpc.c:1739` 和 `networking/udhcp/arpping.c:36`。

ARP 检测的目的不是检查网关是否可达，也不是检查网络是否通，而是防止 IP 冲突：

```text
收到 DHCPACK，server 给出 yiaddr
  -> 发送 ARP request: 谁在用这个 IP？
      |
      |-- 没有 ARP reply
      |     -> 认为地址可用
      |     -> 执行 bound/renew 脚本配置 IP
      |
      |-- 收到 ARP reply
            -> 说明地址已被占用
            -> 发送 DHCPDECLINE 给 DHCP server
            -> 不执行 bound/renew 配置脚本
            -> 回到 INIT_SELECTING 重新申请
```

源码里 `arpping()` 返回值也按这个语义设计：返回 `1` 表示没有收到 ARP reply，地址看起来可用；返回 `0` 表示收到冲突回应。冲突时 `udhcpc` 会打印 offered address is in use，调用 `send_decline(server_id, packet.yiaddr)`，然后把状态改回 `INIT_SELECTING`，见 `networking/udhcp/dhcpc.c:1750`。

通过 ARP 检测后，才执行脚本事件：

- 从 `REQUESTING` 进入时执行 `bound`。
- 从 `RENEWING/REBINDING` 续租成功时执行 `renew`。

这段逻辑在 `networking/udhcp/dhcpc.c:1704` 和 `networking/udhcp/dhcpc.c:1773`。

执行脚本后，如果有 `-q` 就退出；否则如果不是前台模式，MMU 平台会后台化；最后设置 `timeout = lease_remaining / 2`，回到 `BOUND` 等待半个租约时间，见 `networking/udhcp/dhcpc.c:1779`。

### RENEWING

`BOUND` 等到半个租约时间后进入 `RENEWING`，见 `networking/udhcp/dhcpc.c:1486`。

动作：

- 切到 `LISTEN_KERNEL`，也就是普通 UDP socket。
- 调用 `send_renew(server_id, requested_ip)` 单播给原 DHCP server。
- 包里设置 `ciaddr = requested_ip`，并且不再带 `requested IP` 和 `server identifier`，符合 DHCP renew 语义，见 `networking/udhcp/dhcpc.c:779`。

如果没有回应但剩余租约还大于 30 秒，`udhcpc` 会关闭 socket，回到 `BOUND` 再等一段时间后继续尝试。若租约快结束，则进入 `REBINDING`。

### REBINDING

代码在 `networking/udhcp/dhcpc.c:1530`。

动作：

- 切回 `LISTEN_RAW`。
- 调用 `send_renew(0, requested_ip)` 广播续租。
- 如果收到 `DHCPACK`，执行 `renew` 脚本并回到 `BOUND`。
- 如果租约到期仍无回应，执行 `deconfig`，回到 `INIT_SELECTING` 重新发现。

### RELEASED

释放逻辑在 `perform_release()`，见 `networking/udhcp/dhcpc.c:1106`。

触发方式：

- 收到 `SIGUSR2`。
- 退出时带 `-R`，即 release on quit。

如果当前处于已持有租约相关状态，`udhcpc` 会发送 `DHCPRELEASE`；无论是否真的发出 release，都会执行 `deconfig` 脚本，然后进入 `RELEASED`。

## 7. 两种监听模式

`listen_mode` 定义在 `networking/udhcp/dhcpc.c:981`：

| 模式 | socket | 使用场景 |
| --- | --- | --- |
| `LISTEN_NONE` | 无监听 socket | 不需要收包，或等待下一次动作 |
| `LISTEN_RAW` | `PF_PACKET/SOCK_DGRAM` | 尚无 IP 时接收广播 DHCP 包 |
| `LISTEN_KERNEL` | `PF_INET/SOCK_DGRAM` | 已有 IP 后接收单播续租回应 |

切换函数是 `change_listen_mode()`，见 `networking/udhcp/dhcpc.c:1086`。它会先关闭旧 socket，再根据新模式创建 socket。

raw socket 创建在 `udhcp_raw_socket()`，见 `networking/udhcp/dhcpc.c:1002`。它绑定到接口 index，接收 IPv4 以太网帧，并在 `d4_recv_raw_packet()` 中手动检查 IP/UDP 头、checksum、DHCP magic cookie，见 `networking/udhcp/dhcpc.c:871`。

kernel UDP socket 创建在 `udhcp_listen_socket()`，见 `networking/udhcp/socket.c:79`。它绑定 UDP port 68，并用 `SO_BINDTODEVICE` 绑定网卡。kernel 模式收包用 `udhcp_recv_kernel_packet()`，只需读取 DHCP payload 并检查 magic cookie，见 `networking/udhcp/packet.c:83`。

为什么要两种模式：

- 没拿到 IP 前，普通 UDP socket 很难完整处理 `0.0.0.0:68` 到广播包的场景，所以用 raw socket。
- 拿到 IP 后续租时，客户端已经配置了地址，可以用 kernel UDP 栈处理单播，代码更简单，也符合 renew 的发送路径。

## 8. 发包路径

发包函数主要在 `dhcpc.c`：

| 函数 | DHCP 消息 | 特点 |
| --- | --- | --- |
| `send_discover()` | `DHCPDISCOVER` | raw broadcast，可能带 `requested IP` |
| `send_select()` | `DHCPREQUEST` | raw broadcast，带 `requested IP` 和 `server ID` |
| `send_renew()` | `DHCPREQUEST` | 可单播或广播，设置 `ciaddr` |
| `send_decline()` | `DHCPDECLINE` | ARP 检测发现地址冲突时广播 |
| `send_release()` | `DHCPRELEASE` | 释放租约，通常单播给 server |

`send_decline()` 只在 ARP 地址冲突检测失败时使用。它告诉 DHCP server：“你刚给我的地址已经有人在用，我拒绝这个地址。”发送后客户端不会配置该地址，而是重新进入发现流程。这个行为对应 RFC 2131 里客户端在发现地址已占用时必须发送 `DHCPDECLINE` 并重新开始配置的要求，源码注释也直接引用了这一段，见 `networking/udhcp/dhcpc.c:1741`。

每个发包函数都会先调用 `init_packet()`，再添加特定 option。`init_packet()` 会调用 `udhcp_init_header()` 填 `op/htype/hlen/cookie/message type`，再填 `xid`、`secs` 和 `chaddr`，见 `networking/udhcp/dhcpc.c:590` 和 `networking/udhcp/packet.c:16`。

通用 option 添加在 `add_client_options()`，见 `networking/udhcp/dhcpc.c:608`：

- 添加最大 DHCP 包大小 `DHCP_MAX_SIZE`。
- 根据 `opt_mask` 生成 parameter request list，也就是 option 55。
- 如果 `-B` 且 `ciaddr == 0`，设置 broadcast flag。
- 把 `-x`、vendor、client-id 等用户/默认 option 加入包。

底层发送分两类：

- `udhcp_send_raw_packet()` 自己构造 IP/UDP 头并通过 `PF_PACKET` 发出，见 `networking/udhcp/packet.c:108`。
- `udhcp_send_kernel_packet()` 让 kernel 处理 IP/UDP 头，通过普通 UDP socket 发出，见 `networking/udhcp/packet.c:194`。

## 9. 收包过滤路径

收到网络事件后，主循环按当前模式调用不同接收函数：

- `LISTEN_KERNEL`：`udhcp_recv_kernel_packet()`。
- `LISTEN_RAW`：`d4_recv_raw_packet()`。

读取成功后，还要经过三层过滤：

1. `xid` 必须等于 `client_data.xid`，否则不是本次事务的包，见 `networking/udhcp/dhcpc.c:1628`。
2. `hlen` 必须是 6，`chaddr` 必须等于本机 MAC，见 `networking/udhcp/dhcpc.c:1636`。
3. 必须有 `DHCP_MESSAGE_TYPE` option，见 `networking/udhcp/dhcpc.c:1645`。

通过过滤后，才按当前状态解释 `DHCPOFFER`、`DHCPACK`、`DHCPNAK`。

## 10. Option 解析和脚本环境变量

`common.c` 里有一张 DHCP option 描述表 `dhcp_optflags[]`，见 `networking/udhcp/common.c:17`。它描述每个 option 的类型、是否是 list、是否默认请求。对应的脚本环境变量名在 `dhcp_option_strings[]`，见 `networking/udhcp/common.c:92`。例如：

- option 1 -> `subnet`
- option 3 -> `router`
- option 6 -> `dns`
- option 12 -> `hostname`
- option 15 -> `domain`
- option 51 -> `lease`
- option 54 -> `serverid`

option 扫描流程：

1. `init_scan_state()` 初始化扫描状态。
2. `udhcp_scan_options()` 顺序读取 `[code][len][data...]`，支持 DHCP option overload，即 option 区域不够时继续扫描 `file` 和 `sname` 字段。
3. `udhcp_get_option()` 查找指定 option。
4. `udhcp_get_option32()` 只接受长度为 4 的 option，适合 lease time、server id 等字段。

这些函数在 `networking/udhcp/common.c:233` 到 `networking/udhcp/common.c:351`。

脚本环境变量由 `fill_envp()` 生成，见 `networking/udhcp/dhcpc.c:465`：

- 总是生成 `interface=<ifname>`。
- 遍历 DHCP options，已知 option 按类型转成可读字符串；未知 option 生成为 `optNNN=<hex>`。
- subnet option 额外生成 `mask=<prefix_len>`。
- `yiaddr` 生成为 `ip=<address>`。
- `siaddr`、`giaddr`、`boot_file`、`sname` 在存在时也会导出。

随后 `d4_run_script()` 调用外部脚本，参数是事件名，例如 `bound`、`renew`、`deconfig`，见 `networking/udhcp/dhcpc.c:558`。

示例脚本 `examples/udhcp/simple.script` 说明了这些变量如何被消费：

- `deconfig`：清空接口 IPv4 地址并拉起接口，见 `examples/udhcp/simple.script:18`。
- `bound|renew`：配置 `$ip/$subnet`，添加 `$router` 默认路由，写入 `$dns` 到 resolv.conf，见 `examples/udhcp/simple.script:28`。

## 11. 信号语义

`udhcpc` 支持三个主要信号，usage 文本在 `networking/udhcp/dhcpc.c:1194`：

| 信号 | 行为 |
| --- | --- |
| `SIGUSR1` | 手动续租。如果已经释放，则重新进入 `INIT_SELECTING` |
| `SIGUSR2` | 释放当前租约，执行 `deconfig`，进入 `RELEASED` |
| `SIGTERM` | 退出；如果带 `-R`，退出前 release |

信号不是直接在 handler 中处理。`signal_handler()` 只把信号号写入 pipe，见 `networking/udhcp/signalpipe.c:26`；主循环在 `networking/udhcp/dhcpc.c:1560` 读取并处理。

## 12. ifupdown 集成

BusyBox `ifupdown` 可以调用 `udhcpc`。相关代码在 `networking/ifupdown.c:637` 和 `networking/ifupdown.c:677`。

默认传给 `ifup` 的 `udhcpc` 选项来自 `IFUPDOWN_UDHCPC_CMD_OPTIONS`，默认是 `-R -n`，见 `networking/Config.src:90`：

- `-R`：退出时 release IP。
- `-n`：拿不到 lease 就退出。

`ifdown` 时会读取 `/var/run/udhcpc.%iface%.pid` 并 kill 对应进程，见 `networking/ifupdown.c:713`。

## 13. 谁会启动 udhcpc

`udhcpc` 是一个普通用户态程序，真正启动它的通常是网络管理层、服务脚本或用户手动命令。BusyBox 源码和示例里能看到这些触发路径：

### 手动命令

最直接的方式是用户或脚本直接执行：

```sh
udhcpc -i eth0 -s /usr/share/udhcpc/default.script
```

这种方式绕过 `ifupdown`，直接启动 DHCP 协议协商。

### ifup

如果 `/etc/network/interfaces` 里把接口配置为 DHCP：

```text
auto eth0
iface eth0 inet dhcp
```

执行：

```sh
ifup eth0
```

`ifupdown` 会根据 `iface eth0 inet dhcp` 选择 DHCP client。若启用了 BusyBox 内置 `udhcpc` 路径，最终会执行类似：

```text
udhcpc <IFUPDOWN_UDHCPC_CMD_OPTIONS> -p /var/run/udhcpc.eth0.pid -i eth0 ...
```

对应源码在 `networking/ifupdown.c:637` 和 `networking/ifupdown.c:677`。

### service / runsv 服务脚本

BusyBox 示例还提供了 supervision 风格的 DHCP service。`examples/var_service/dhcp_if/run` 会先把接口 up，然后直接 `exec udhcpc`：

```sh
udhcpc -vv \
  --foreground \
  --interface="$if" \
  --pidfile="$pwd/udhcpc.pid" \
  --script="$pwd/dhcp_handler"
```

这类场景里，`udhcpc` 不是由 `ifup` 启动，而是由 `runsv`、`svc` 或类似服务管理器启动。示例说明见 `examples/var_service/README:99`，实际启动命令见 `examples/var_service/dhcp_if/run:13`。

### ifplugd 间接触发

`ifplugd` 本身不执行 DHCP 协议，它负责监控网线插拔或链路 up/down。BusyBox 示例里，链路 up 时 `ifplugd_handler` 会执行：

```sh
svc -u "dhcp_$1"
```

这会启动对应的 `dhcp_<iface>` service，而该 service 的 `run` 脚本再启动 `udhcpc`。链路 down 时则执行 `svc -d "dhcp_$1"` 停掉 DHCP service。对应示例在 `examples/var_service/ifplugd_if/ifplugd_handler:12`。

关系可以概括为：

```text
手动命令
  -> udhcpc

ifup eth0
  -> ifupdown
  -> udhcpc

ifplugd 检测到 link up
  -> svc -u dhcp_eth0
  -> runsv 启动 dhcp_if/run
  -> udhcpc

init/rcS/system service 脚本
  -> udhcpc
```

注意反方向：`udhcpc` 拿到租约后会调用 `-s` 指定的脚本，例如 `default.script` 或 `dhcp_handler`。这些脚本通常是被 `udhcpc` 调用来配置 IP、路由和 DNS，不是用来启动 `udhcpc` 的。

## 14. 一次完整协商的源码路径

以正常拿到租约为例：

```text
udhcpc_main()
  -> 参数解析、初始化 client_data
  -> d4_run_script_deconfig()
  -> state = INIT_SELECTING

INIT_SELECTING timeout
  -> change_listen_mode(LISTEN_RAW)
  -> send_discover()
     -> init_packet(DHCPDISCOVER)
     -> add_client_options()
     -> udhcp_send_raw_packet()

收到 DHCPOFFER
  -> d4_recv_raw_packet()
  -> 校验 xid/chaddr/message type
  -> 保存 server_id 和 requested_ip
  -> state = REQUESTING

REQUESTING timeout
  -> send_select(server_id, requested_ip)
     -> init_packet(DHCPREQUEST)
     -> 添加 requested IP + server ID
     -> add_client_options()
     -> udhcp_send_raw_packet()

收到 DHCPACK
  -> 读取 lease time
  -> 可选 arpping 检测地址冲突
  -> fill_envp()
  -> d4_run_script(packet, "bound")
  -> state = BOUND
  -> timeout = lease_remaining / 2
```

后续续租路径：

```text
BOUND timeout
  -> state = RENEWING
  -> change_listen_mode(LISTEN_KERNEL)
  -> send_renew(server_id, requested_ip)

收到 DHCPACK
  -> d4_run_script(packet, "renew")
  -> state = BOUND
```
