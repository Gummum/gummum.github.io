---
title: "stm32ota方案"
categories:
  - 单片机
---

# 前置知识

## flash

### flash是如何工作的

- Flash 单元以电荷存储表示 0/1，编程只能把位从 1 写为 0，擦除把整页/扇区统一恢复为 1。
- 擦除粒度通常为 Page/Sector（几 KB 到几十 KB），编程粒度为 半字/字/双字（依芯片而异，STM32F1/F4 常见为半字/字，STM32G4/H7 常见为双字）。
- 由于擦写次数有限（10k~100k 次/页），需避免频繁在同一页更新小量数据；对“升级信息/设备信息”等高频写区域应做磨损均衡或冗余备份。
- 一些系列支持 Dual-Bank，可在运行一侧时擦写另一侧，利于在线升级；部分系列带 ECC，写入时需按对齐和双字写入以避免 ECC 错误。

### 常见的flash

- 片内 Flash（NOR）：启动代码存储，随机读取快、可靠；容量相对有限。
- 片外 SPI NOR Flash：容量大、成本低、顺序读写快；擦写需页对齐，写前要擦除；通过 QSPI/OSPI 可做 XIP（部分系列）。
- 片外 NAND：大容量，坏块管理复杂，MCU 端较少用于固件存储；如果使用，建议在外部处理器或文件系统层处理。

### flash的读写操作

- 典型流程（STM32 HAL）：
  1) `HAL_FLASH_Unlock()`；2) 擦除 `HAL_FLASHEx_Erase(...)`；3) 按对齐写入 `HAL_FLASH_Program(...)`；4) `HAL_FLASH_Lock()`。
- 写前确保：关中断临界区（至少屏蔽影响时序的中断）、设置合适的 Flash Latency、关闭数据/指令 Cache（视系列而定）。
- 断电保护：写入分块+页校验+幂等策略；Bootloader 应确保任意掉电后都能从“最后一次一致状态”恢复。

## 什么是ota,ota的作用是什么

OTA（Over-The-Air/Over-The-Any-link）是设备在不拆机、不中断服务或最小中断的前提下，通过通信链路远程更新固件的能力。作用：

- 降低维护成本：远程修复缺陷、发布新功能。
- 提升安全：及时修补漏洞、轮换证书/密钥。
- 提升可靠性：引入回滚与试运行机制，降低升级失败风险。

## 在单片机端有哪些ota方案,优缺点是什么

- 单区原地升级（In-place）：
  - 思路：Bootloader 在同一分区内边擦边写覆盖旧固件。
  - 优点：占用 Flash 空间最小。
  - 缺点：掉电风险高、实现复杂，需要小心搬移和断点续传；通常需额外“备份页”或外设辅助。
- 片内双区（A/B）：
  - 思路：两套固件分区，当前运行 A，下载到 B，切换启动标志后从 B 启动，失败可回退到 A。
  - 优点：最稳妥，掉电可恢复，支持试运行与确认。
  - 缺点：占用两倍固件空间；对小容量芯片可能不现实。
- 片外缓存升级：
  - 思路：固件先存片外 Flash，验证通过后拷贝/交换到片内运行区。
  - 优点：适配小容量片内 Flash；可存多版本或差分包。
  - 缺点：依赖外设稳定性，增加 BOM 和驱动复杂度。
- 差分升级（Patch）：
  - 思路：只下发旧版到新版的差分数据，在设备端重建新固件。
  - 优点：大幅减少下载体积。
  - 缺点：设备端计算/IO 复杂度高；需强校验和回退；对压缩/链接方式敏感，易产生大差分。

## 单片机是如何启动的,bootloader又是什么

- 复位后 CPU 从固定地址取栈顶与复位向量（向量表），跳入启动代码；用户可通过 `SCB->VTOR` 变更向量表基址。
- Bootloader 是最先运行的用户程序，负责：
  - 验证与选择要启动的固件镜像
  - 处理升级数据的接收与写入
  - 管理升级状态（试运行/确认/回退）与断点续传
  - 安全校验（签名验证、版本反回滚）
- 关键：Bootloader 自身要尽量小且稳定，放在写保护区域，最好配合读保护/代码保护（RDP/WRP/PCROP）。

### System Bootloader

- STM32 内置的系统 Bootloader（ROM）支持通过 UART/I2C/SPI/USB DFU 等协议下载固件，不占用用户 Flash。
- 适用场景：产线烧录、救援刷机、无用户 Bootloader 的简化升级路径。
- 局限：协议固定、可定制性弱、难以做安全验签/回滚等策略，一般作为兜底或引导方式。

## 加密与签名

- 签名用于完整性和身份认证，推荐“哈希 + 非对称签名”：

  - 固件哈希：SHA-256/384
  - 签名算法：ECDSA-P256 或 Ed25519（如 MCU 资源允许）
  - 验签公钥固化在 Bootloader 的受保护区域
- 加密用于保密：

  - 算法：AES-CTR/CBC（配 HMAC-SHA256）或 AES-GCM（一体化保密+完整性）
  - 密钥管理：设备唯一密钥（通过 KDF 由主密钥+设备 ID 派生），密钥存于 OB/TrustZone/安全存储，切勿明文硬编码
- 反回滚：在安全计数器中存储“已知最大版本号”，新固件版本必须大于该计数；该计数放到写保护或特定 Option Bytes 中。

### 加密与签名流程

1. 厂商编译固件 firmware.bin
2. 计算固件哈希 → 用厂商私钥签名 → 得到 signature
3. 用对称密钥（AES）加密固件 → 得到 firmware.enc
4. 把 AES 密钥用设备公钥加密 → 得到 key.enc
5. 最终打包成升级包 { firmware.enc, key.enc, signature }
6. 设备收到升级包 → 验签（公钥验证签名）
7. 验证通过 → 解密 AES 密钥 → 解密固件 → 烧写到 Flash

## 回滚机制

- 引入 A/B 或 Trial-Run 机制：

  - 状态机：`下载完成 -> 待切换 -> 试运行 -> 已确认/回滚`
  - 试运行：首次启动新固件时仅给短超时窗口，应用启动后需上报“确认”标志；超时或崩溃由看门狗复位后回退。
- 标志写入需原子：使用“双写+校验”或“主备信息页”保证任何时刻至少有一份一致数据。
- 回滚时要阻止新固件再次被误判为可启动（清除 pending 标志）。

## DFU

- USB DFU（Device Firmware Upgrade）是标准 USB 类；STM32 可使用系统 Bootloader 进入 DFU 或用户自实现 DFU 类。

- 工具链：STM32CubeProgrammer 支持 DFU；历史上 ST 的 DfuSe (.dfu) 格式已逐步被通用 BIN/HEX + DFU 协议替代。
- 适合与 PC/手机直连升级；作为 OTA 的补充通道或维护模式。

## 差分升级

- 生成方式：在云端用 bsdiff/xdelta 等算法对旧版与新版做差，得到补丁包；

- 应用方式：设备端根据补丁在片外/片内缓冲区重建新固件，再校验哈希/签名；

- 注意事项：
  - 对链接地址、填充、压缩很敏感；需固定链接脚本、关闭随机化与冗余填充，尽量保持节对齐一致。
  - 资源评估：解补丁需要 RAM/存储缓冲，建议使用流式重建（读旧块-应用补丁-写新块）。
  - 失败兜底：保留旧版或能从补丁失败回到旧版。

# 方案实施

## flash方案

### 方案一 - 单区ota

- Bootloader分区
- Firmware分区
- 升级信息分区
- 备份升级信息分区
- 设备信息分区
- 用户数据分区

适用：片内空间非常紧张但可接受较高实现复杂度的项目。

要点：

- 采用块搬移与“最后写入胜出”的元数据设计，保证掉电可恢复。
- 需要临时缓冲（RAM/片外）以重写页面；严格的断点续传。
- 风险较高，优先用于小固件+可靠供电场景。

### 方案二 - 片内双区

- Bootloader分区
- Firmware分区
- 升级信息分区
- 备份升级信息分区
- 设备信息分区
- 用户数据分区

适用：大多数需要稳健 OTA 的项目。

建议内存映射（以 1MB 片内 Flash 为例，仅示意）：

- Bootloader：0x0800_0000 ~ 0x0800_7FFF（32~64KB，WRP 只写保护）
- App A：0x0800_8000 ~ 0x0804_FFFF
- App B：0x0805_0000 ~ 0x0809_7FFF
- Upgrade Info：独立 2 页（主/备），存版本、状态、激活标志、镜像哈希
- Device Info/User Data：单独页，配合磨损均衡

切换流程：

1) 运行 A，下载 B -> 完整性校验通过 -> 设置“待切换到 B”
2) 复位进入 Bootloader，验证 B 签名 -> 设置“试运行 B”并跳转 B
3) B 启动成功后上报“已确认”-> Bootloader 下次启动清理 pending
4) 若 B 崩溃/超时未确认 -> 看门狗复位 -> Bootloader 回退到 A

### 方案三 - 片外flash

内部flash:

- Bootloader分区
- Firmware分区

外部flash:

- OTA升级分区
- 升级信息分区
- 备份升级信息分区
- 设备信息分区
- 用户数据分区

适用：片内空间不足或需要存多版本/大资源。

要点：

- 固件先存外部 OTA 分区，Bootloader 验签后拷贝到片内运行区；
- 支持断点续传与分块拷贝，拷贝后再次校验片内哈希；
- 外部 Flash 建议配冗余标记与坏块规避（若为 NAND）。

### 方案四 - 片外差分升级

内部flash:

- Bootloader分区
- Firmware分区

外部flash:

- OTA升级分区
- 升级信息分区
- 备份升级信息分区
- 设备信息分区
- 用户数据分区
- 差分升级分区

适用：带宽昂贵、版本相邻且差异较小。

要点：

- 外部存放补丁+旧版，设备端重建新版到外部临时区，再整体拷贝入片内运行区；
- 任一步骤失败均可回退；补丁与重建结果均需验签。

## 下载方案

### 串口下载

- 协议：可用 X/YModem、SLIP/CBOR、自定义 TLV 帧；每帧含序号、长度、CRC32/CRC16；支持重传与窗口。
- 速率：115200~1.5Mbps（视硬件），注意流控与 DMA。
- 断点续传：记录已确认的最大偏移，重入时从该偏移继续。
- 安全：优先在上位机侧对包做签名，设备端仅在写入前后做哈希校验，最终由 Bootloader 统一验签。

### 串口蓝牙下载

- BLE OTA：基于 GATT 自定义特征，分片大小受 MTU/连接参数限制（常见 20~244 字节/包）；
- 需做包序/ACK/超时与断点续传；可在 App 层做 AES 加密传输；
- 手机侧常见做法：HTTPS 拉取 -> App 切片 -> BLE 发送 -> 设备缓存到外部/片内。

### wifi下载

- 直连云端 HTTP/HTTPS：支持 Range 断点续传、MD5/SHA-256 校验；
- TLS：校验证书链与域名，固化根证书或使用设备唯一证书；
- 大文件：边下边写 Flash，分段校验与回退；
- 失败重试与限速、指数退避；
- 代理：若通过网关/手机热点，注意超时与弱网切换。

## 固件打包方案

推荐定义自研“容器包”（Header + Payload [+ Signature]），示例：

Header 字段（按小端对齐，示例）：

- MAGIC：4B 固定魔数，例如 0x4F54415F（"OTA_")
- FORMAT_VER：1B
- IMG_TYPE：1B（Full=0x01, Patch=0x02）
- TARGET_ID：2B（系列/型号/板卡 ID）
- FW_VER：4B（单调递增）
- IMG_SIZE：4B（负载长度）
- HASH_TYPE：1B（SHA-256=0x01）
- HASH[32]：32B（payload 哈希）
- SIG_TYPE：1B（ECDSA-P256=0x01 / Ed25519=0x02）
- SIG_SIZE：2B
- RESERVED：对齐填充

Payload：

- 对于 Full：即整镜像（可再分段加密）
- 对于 Patch：差分数据（含补丁算法标识与元数据）

Signature：

- 对 Header(除 Signature 区) + Payload 的哈希做签名

设备端流程：

1) 读取 Header -> 基本合法性检查（MAGIC、长度、目标 ID、版本反回滚）
2) 流式验哈希（边写边算）
3) 完成后验签（或分段验签）
4) 通过后才切换状态标志

可选：在 Header 中加入最小/目标 Bootloader 版本、编译时间戳、发布渠道等。

## 加密与签名方案

两种常用模式：

- 完整性优先：仅签名不加密，节省设备端资源，适用于固件不涉密场景；
- 机密性+完整性：AES-GCM 加密（含 tag）+ 版本化密钥轮换，或 AES-CTR/CBC + HMAC-SHA256；

实施建议：

- 公钥置于 Bootloader 受保护区域（WRP/PCROP），Bootloader 自检公钥哈希；
- 私钥仅在离线打包机；
- 设备唯一密钥存储于安全区域，通过 KDF（HMAC-SHA256）由主密钥与 UID 派生；
- 反回滚计数写保护；
- 所有状态写入采用“双页主备 + 序列号”结构，保证原子性。

示例状态结构（简化）：

```c
struct UpgradeState {
  uint32_t magic;          // 'USTA'
  uint32_t seq;            // 单调递增序列号
  uint32_t active_slot;    // 0=A,1=B
  uint32_t pending_slot;   // 0/1/0xFFFFFFFF(无)
  uint32_t trial;          // 0/1
  uint32_t fw_ver_a;
  uint32_t fw_ver_b;
  uint8_t  hash_a[32];
  uint8_t  hash_b[32];
  uint32_t crc32;          // 结构体 CRC
};
```

Bootloader 核心流程（伪代码）：

```c
if (!state_valid()) recover_from_backup();
if (has_pending()) {
  if (verify_image(pending_slot)) {
    set_trial(pending_slot); reboot_to_slot(pending_slot);
  } else {
    clear_pending(); stay_on_active();
  }
} else if (is_trial()) {
  if (trial_confirmed_flag()) {
    finalize_trial();
  } else {
    rollback_to_active_backup();
  }
}
jump_to_active_image();
```

应用确认点：应用完成自检/联网验证后设置“已确认”标志（如写状态页或设置备份寄存器），随后可继续业务逻辑。
