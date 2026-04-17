---
title: "计算机网络-DHCP"
categories:
  - 计算机网络
---

## 1. 什么是 DHCP？

**DHCP (Dynamic Host Configuration Protocol)**，即动态主机配置协议，是一个局域网的网络协议。它使用 UDP 协议工作。

在没有 DHCP 的年代，网络管理员需要手动为每一台计算机配置 IP 地址、子网掩码、网关和 DNS 服务器。这不仅繁琐，而且容易出错（例如 IP 地址冲突）。DHCP 的出现就是为了解决这个问题，它能够**自动**地为网络中的设备分配 IP 地址和其他网络参数。

### 核心功能

- **自动分配 IP**：设备连入网络后自动获取合法的 IP 地址。
- **统一管理**：由服务器集中管理 IP 地址池，避免冲突。
- **参数配置**：除了 IP，还能下发子网掩码、默认网关、DNS 等信息。

---

## 2. DHCP 工作流程 (DORA)

DHCP 的交互过程非常经典，通常被称为 **DORA** 过程，取自四个关键报文的首字母：

1. **D**iscover（发现）：客户端在网络中大喊：“有没有人能给我一个 IP？”
2. **O**ffer（提供）：服务器回复：“我有，这个 IP (192.168.x.x) 给你用怎么样？”
3. **R**equest（请求）：客户端确认：“好的，我就要这个 IP 了。”
4. **A**CK（确认）：服务器敲定：“好的，记下来了，这个 IP 归你了。”

---

## 3. 实战抓包分析

我们通过一次真实的 Wireshark 抓包数据来详细分析这四个步骤。

**测试环境信息：**

- **客户端 (Client)**：MAC 地址 `10:06:48:a4:7b:3b` (DreameInnova)
- **服务器 (Server)**：IP `192.168.10.1`，MAC 地址 `18:f2:2c:bb:0e:8d` (TpLink)
- **交互 ID (Transaction ID)**：`0x3dccfd1a` (用于标识同一轮会话)

### 第一步：DHCP Discover (发现)

客户端启动或接入网络时，它不知道网络里有没有 DHCP 服务器，也不知道自己该用什么 IP。所以它发送一个**广播**包。

```txt
No.     Time           Source       Destination       Protocol Length Info
1       10:31:15.159   0.0.0.0      255.255.255.255   DHCP     342    DHCP Discover - Transaction ID 0x3dccfd1a
```

**关键字段分析：**

- **传输层**：UDP，源端口 **68** (Client)，目的端口 **67** (Server)。
- **IP 层**：
  - `Src: 0.0.0.0`：因为客户端还没有 IP，只能用全 0 代表自己。
  - `Dst: 255.255.255.255`：受限广播地址，发给局域网内所有设备。
- **DHCP 负载**：
  - `Message type: Boot Request (1)`：这是一个请求报文。
  - `Transaction ID: 0x3dccfd1a`：这是会话的身份证，后续所有交互都要带上它。
  - `Client MAC address`: `10:06:48:a4:7b:3b`：表明“我是谁”。
  - `Option: (53) DHCP Message Type`: **Discover**。
  - `Option: (55) Parameter Request List`：客户端告诉服务器“我还需要子网掩码、路由、DNS等信息”。

### 第二步：DHCP Offer (提供)

局域网内的 DHCP 服务器收到了广播，从地址池里挑了一个空闲 IP (`192.168.10.103`)，预留下来，并回复给客户端。

```txt
No.     Time           Source         Destination       Protocol Length Info
2       10:31:15.391   192.168.10.1   255.255.255.255   DHCP     331    DHCP Offer    - Transaction ID 0x3dccfd1a
```

**关键字段分析：**

- **IP 层**：
  - `Src: 192.168.10.1`：服务器的 IP。
  - `Dst: 255.255.255.255`：仍然是广播。虽然服务器知道客户端 MAC，但客户端此时还没有配置 IP 协议栈，为了保证客户端能收到，通常使用广播（部分系统支持单播）。
- **DHCP 负载**：
  - `Message type: Boot Reply (2)`：这是一个回复报文。
  - `Your (client) IP address`: **192.168.10.103**。这是服务器给出的“预选” IP。
  - `Option: (53) DHCP Message Type`: **Offer**。
  - `Option: (54) DHCP Server Identifier`: `192.168.10.1`。表明是哪台服务器提供的。
  - `Option: (51) IP Address Lease Time`：租期。
  - `Option: (1) Subnet Mask`: `255.255.255.0`。
  - `Option: (3) Router`: 网关地址。

### 第三步：DHCP Request (请求)

客户端可能收到多个服务器的 Offer（如果网络里有多个 DHCP 服务器），它通常选择最先收到的那个。然后，它再次发送**广播**，告诉所有服务器它的选择。

**为什么是广播？**
为了告诉**被选中**的服务器“我选你了”，同时告诉**其他**服务器“我选了别人，你们可以把预留的 IP 释放了”。

```txt
No.     Time           Source       Destination       Protocol Length Info
3       10:31:15.412   0.0.0.0      255.255.255.255   DHCP     342    DHCP Request  - Transaction ID 0x3dccfd1a
```

**关键字段分析：**

- **IP 层**：
  - `Src: 0.0.0.0`：注意！虽然 Offer 里给了 IP，但客户端**还没正式使用**它，所以源 IP 还是 0.0.0.0。
- **DHCP 负载**：
  - `Message type: Boot Request (1)`。
  - `Option: (53) DHCP Message Type`: **Request**。
  - `Option: (50) Requested IP Address`: **192.168.10.103**。明确请求这个 IP。
  - `Option: (54) DHCP Server Identifier`: **192.168.10.1**。明确指定接受这台服务器的 Offer。

### 第四步：DHCP ACK (确认)

服务器收到 Request 后，确认该 IP 确实可以分配，便发送 ACK 包。这是最后一步。

```txt
No.     Time           Source         Destination       Protocol Length Info
4       10:31:15.508   192.168.10.1   255.255.255.255   DHCP     331    DHCP ACK      - Transaction ID 0x3dccfd1a
```

**关键字段分析：**

- **IP 层**：
  - `Src: 192.168.10.1` -> `Dst: 255.255.255.255`。
- **DHCP 负载**：
  - `Message type: Boot Reply (2)`。
  - `Your (client) IP address`: **192.168.10.103**。
  - `Option: (53) DHCP Message Type`: **ACK**。
  - `Option: (51) IP Address Lease Time`：正式确立租期。

**结果**：客户端收到 ACK 后，正式将 `192.168.10.103` 配置到自己的网卡上，TCP/IP 协议栈初始化完成，可以正常通信了。

---

## 4. DHCP 报文格式

DHCP 报文是承载在 UDP 之上的。以下是常见的报文结构：

```txt
0                   1                   2                   3
0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|     Op (1)    |   Htype (1)   |   Hlen (1)    |   Hops (1)    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Transaction ID (4)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|      Seconds (2)              |      Flags (2)                |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   Client IP Address (ciaddr)                  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   Your IP Address (yiaddr)                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   Server IP Address (siaddr)                  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   Relay Agent IP Address (giaddr)             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                Client Hardware Address (chaddr)               |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                  Server Host Name (sname)                     |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                  Boot File Name (file)                        |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                  Options (variable)                           |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

- **Op (Operation)**: 报文类型。1 = Request (Client发出的), 2 = Reply (Server发出的)。
- **Transaction ID (Xid)**: 事务 ID，由客户端生成的随机数，用于匹配请求和响应。在你的抓包中是 `0x3dccfd1a`。
- **Yiaddr (Your IP)**: 服务器分配给客户端的 IP 地址。
- **Chaddr (Client Hardware Address)**: 客户端的 MAC 地址。
- **Options**: 这是一个变长字段，非常重要。所有的扩展信息（如掩码、网关、DNS、报文类型）都放在这里。
  - **Option 53**: 标识 DHCP 报文类型（Discover/Offer/Request/ACK）。
  - **Option 55**: 请求参数列表。
  - **Option 50**: 请求的 IP 地址。

## 5. 常见问题

### 为什么 DHCP 使用 UDP？

因为 UDP 开销小，且在没有 IP 地址的情况下，建立 TCP 连接（三次握手）是不可能的。DHCP 利用广播机制，UDP 更适合这种场景。

### 租期 (Lease Time) 是什么？

IP 地址不是永久给你的，而是“租”给你的。租期到了，如果你不续约，服务器就会收回。

- **T1 计时器 (50% 租期)**：客户端会**单播**向服务器请求续约（Request）。
- **T2 计时器 (87.5% 租期)**：如果 T1 续约失败（比如服务器挂了），客户端会**广播**请求续约，看有没有其他服务器能帮忙。
