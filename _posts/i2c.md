---
title: "I2C"
categories:
  - 硬件通信协议
---

## 协议

常用的数据帧格式包括：

1. 起始条件（START）：SCL高电平时，SDA从高变低
2. 7位/10位从设备地址+读/写位（R/W）
3. 应答位（ACK/NACK）
4. 数据传输（8位数据+应答位）
5. 停止条件（STOP）：SCL高电平时，SDA从低变高

通信过程

1. 主机发送起始信号启用总线
2. 主机发送一个字节数据指明从机地址和后续字节的传送方向（0主给从发，1从给主发）
3. 被寻址的从机发送应答信号回应主机
4. 发送器发送一个字节数据
5. 接收器发送应答信号回应发送器
6. 重复4，5步骤
7. 通信完成后主机发送停止信号释放主机

空闲时为高电平

起始信号和停止信号

起始信号：SCL为高时，SDA由高变低
停止信号：SCL为高时，SDA由低变高
每次发送必须8位数据，数据传送时先传送最高位

发送器发送完一个字节数据接收器必须发送1位**应答位（低电平）**来回应，所以一帧共有9位

典型时序

主机向从机发送数据

![主机向从机发送数据](https://pic2.zhimg.com/v2-57d41a637f3e928103c0a7d6e86abc4f_1440w.jpg)

从机向主机发送数据

![从机向主机发送数据](https://pic1.zhimg.com/v2-3cafde0145443c67a57773d3ae39f4fe_1440w.jpg)

主机先向从机发送数据，然后从机再向主机发送数据

![主机先向从机发送数据，然后从机再向主机发送数据](https://picx.zhimg.com/v2-6930ab26629bdeab74637e35724d22bd_1440w.jpg)

在主机发起第二次通信时，主机没有发起停止信号，直接再次发开始。这是因为如果发了停止之后，可能主机就丢失了总线的控制权

## 特性

1. 总线上可连接多个设备，每个设备都有唯一地址
2. 开漏/集电极开路（Open-drain/Open-collector）输出结构，需要上拉电阻
3. 通信速率：
   - 标准模式：100 kbit/s
   - 快速模式：400 kbit/s
   - 高速模式：3.4 Mbit/s
   - 超快速模式：5 Mbit/s
4. 时钟拉伸（Clock stretching）机制：从设备可以通过保持SCL为低电平来延迟通信
5. 总线仲裁机制：多主机环境下，防止数据冲突
6. 支持热插拔（Hot plugging）

## 补充

1. I²C总线的负载能力受总线电容的限制，通常不超过400pF
2. 通信距离一般较短，通常在几米之内
3. 随着距离增加或连接设备增多，需要降低通信速率或使用I²C中继器
4. SMBus（System Management Bus）是I²C的一个子集，添加了电气规范和协议规则
5. 许多现代芯片集成了I²C控制器，支持DMA传输以减少CPU负担
6. I²C总线广泛应用于连接低速外设，如EEPROM、传感器、RTC等
7. 使用开漏输出，是为了避免短路。
8. 使用线与完成仲裁

上拉电阻作用：

​ I2C的接口一般都是OD或者OC门，芯片内部无上拉电阻时，外部需要加上拉电阻才能输出高电平。

多主机总线，连接在IIC总线上的器件分为主机和从机，主机有权发起和结束一次通信，而从机只能被主机呼叫；当总线上有多个主机同时启用总线时，IIC也具有冲突检测和仲裁的功能来防止错误产生。每个连接到IIC总线上的器件都有一个唯一的7bit地址（也有10bit的），每个器件都可以作为主机也可以是从机，但同一时刻只有一个主机，总线上的器件增加和删除不影响其他器件正常工作

参考链接

[https://blog.csdn.net/weixin_52342399/article/details/146000352](https://blog.csdn.net/weixin_52342399/article/details/146000352)

[https://blog.csdn.net/shaguahaha/article/details/70766665](https://blog.csdn.net/shaguahaha/article/details/70766665)

[https://www.nxp.com.cn/docs/en/user-guide/UM10204.pdf](https://www.nxp.com.cn/docs/en/user-guide/UM10204.pdf)

[https://zhuanlan.zhihu.com/p/665019733](https://zhuanlan.zhihu.com/p/665019733)

[https://zhuanlan.zhihu.com/p/694566573](https://zhuanlan.zhihu.com/p/694566573)
