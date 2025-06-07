---
title: "ros基础学习"
categories:
  - ros
---

因为公司用的是`ros`, 作为linux系统方面的开发人员，有必要学习一下。

同时也想学习ros中的机制，对以后开发自己的框架有帮助。

## ROS基础

### ROS背景

机器人操作系统（Robot Operating System，简称ROS）并不是一个操作系统，而是一个为机器人软件开发提供的灵活框架。它为机器人程序开发提供了操作系统所具备的服务，包括硬件抽象、底层设备控制、常用功能实现、进程间通信、包管理等。

ROS 最早由美国 Willow Garage 公司于2007年发起，旨在促进机器人软件的共享与复用。其目标是建立一个标准化、模块化、开源的软件平台，降低机器人开发门槛。

### ROS介绍

ROS = 通信机制 + 开发工具 + 应用功能 + 生态系统：

ROS 采用分布式架构，开发者可以将复杂系统拆分为多个模块（节点），由不同团队开发后进行集成，极大地促进模块复用与协作。

核心组件包括：

- Node（节点）
- Topic（话题）
- Service（服务）
- Parameter（参数）
- Action（动作）
- Launch（启动文件）

### ROS1 和 ROS2 区别

| 特性     | ROS 1 (Legacy) | ROS 2 (Next-Gen) |
| -------- | -------------- | ---------------- |
| 核心通信   | Master (roscore) 集中式管理节点注册和查找 | DDS (Data Distribution Service) 分布式数据发布-订阅，无需中心节点。 |
| 实时性    | 非实时，Linux标准调度，不保证严格时间性。 | 软实时，支持实时操作系统（如PREEMPT_RT Linux），并优化了底层通信以降低延迟和抖动。 |
| 多机通信   | 需手动配置ROS_MASTER_URI等环境变量，网络配置复杂。 | 原生分布式，基于DDS的发现机制，多机通信更简单，无需额外配置，支持P2P通信。 |
| 安全性    | 缺乏内置安全机制，通信默认不加密、不认证。 | 内置安全框架 (SROS2)，支持身份验证、加密和访问控制，满足更严格的应用场景。 |
| QoS (服务质量) | 无显式QoS，通信参数通过API调整。 | 支持丰富的QoS策略 (Reliability, Durability, Liveliness, History等)，可精细控制通信行为。 |
| 编程语言   | 主要支持 C++ (roscpp) 和 Python (rospy)。 | 官方支持 C++ (rclcpp) 和 Python (rclpy)，社区支持更多语言。 |
| 生命周期管理 | 无原生生命周期管理。 | 内置节点生命周期管理 (Unconfigured, Inactive, Active, Finalized)，便于系统启动和关闭。 |
| 组件化    | 较弱，倾向于独立的节点。 | 强调 组件化 (Components)，允许将多个功能模块编译成一个可执行文件，减少进程间通信开销。 |
| Windows/macOS | 官方不支持或支持有限。 | 官方支持 Windows、macOS 以及各种嵌入式系统，扩展了ROS的应用范围。 |
| 社区支持   | 依然活跃，但新功能开发重心已转向ROS 2。 | 快速发展，社区积极投入，是未来机器人开发的趋势。 |

### ROS版本区别

> 各个软件包依赖ubuntu的版本不同，ros组织为了方便管理，将ros分为了多个版本，每个版本都依赖一个ubuntu版本。

ROS1 的主要发行版本包括：

- ROS Kinetic（Ubuntu 16.04）
- ROS Melodic（Ubuntu 18.04）
- ROS Noetic（Ubuntu 20.04，最后一个ROS1版本）

---

ROS2 的主要版本包括：

- ROS2 Foxy（LTS，Ubuntu 20.04）
- ROS2 Galactic（Ubuntu 20.04）
- ROS2 Humble（LTS，Ubuntu 22.04）
- ROS2 Iron / Jazzy 等持续更新中

选择版本时建议使用 LTS（长期支持）版本。

### ROS安装

建议使用鱼香ros的一键安装教程，[鱼香ros](https://www.fishros.com/)

### 节点和包

**节点（Node）：**

- 节点是ROS中最基本的执行单元
- 每个节点都是一个独立的进程
- 节点之间通过ROS通信机制交换信息
- 一个节点通常完成一个特定的功能

**包（Package）：**

- 包是ROS中代码组织的基本单位
- 包含相关的节点、库、配置文件等
- 每个包有唯一的名称
- 包之间可以有依赖关系

包通常包含：

复杂版

```bash
my_package/
├── CMakeLists.txt      # 构建配置
├── package.xml         # 包元信息
├── src/               # 源代码
│   ├── my_node.cpp
│   └── my_library.cpp
├── include/           # 头文件
│   └── my_package/
├── launch/            # 启动文件
│   └── my_launch.launch
├── config/            # 配置文件
│   └── params.yaml
├── msg/               # 消息定义
│   └── MyMessage.msg
├── srv/               # 服务定义
│   └── MyService.srv
└── scripts/           # 脚本文件
    └── my_script.py
```

简单版

```bash
my_package/
├── CMakeLists.txt      # 构建配置
├── package.xml         # 包元信息
└── src/               # 源代码
    ├── my_node.cpp
    └── my_library.cpp
```

ros1通过 `rosrun`、`roslaunch` 启动节点，ros2通过 `ros2 run` 或 `ros2 launch` 启动 `ROS2` 节点。

**节点和包的关系：**

一个ROS包可以包含一个或多个节点，也可以不包含节点只包含库或配置文件。多个节点可以协作完成一个复杂的任务，而这些节点通常会组织在一个或多个相关的包中。这种分层的组织方式使得ROS系统既灵活又易于管理。

### 工作空间概念

- 工作空间是包含ROS包集合的目录
- 提供了独立的开发环境
- 支持多个工作空间的叠加
- 管理包的编译、安装和运行

Catkin (ROS 1) 与 Colcon (ROS 2) 的区别：

- Catkin： 主要针对ROS 1设计，基于CMake，但对其进行了扩展，简化了ROS包的构建过程。
- Colcon： 旨在替代Catkin，支持多种构建系统（CMake、Python setuptools），更加灵活，且兼容ROS 1和ROS 2。Colcon是ROS 2的官方构建工具。

一个ROS工作空间通常包含以下目录：

```bash
your_workspace/
├── src/                  # 源代码目录，存放你的ROS包
│   ├── my_first_package/
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   └── ...
│   └── another_ros_package/
│       ├── CMakeLists.txt
│       ├── package.xml
│       └── ...
├── build/                # 构建目录，编译生成中间文件（由catkin/colcon自动创建）
├── install/              # 安装文件 ros2 是 install
├── devel/                # 运行环境 ros1 是 devel
└── log/                  # 日志目录（由catkin/colcon自动创建）
```

### 基本命令使用

**ROS1 常用命令：**

```bash
roscore # 启动ROS Master

rosrun package_name node_name # 运行节点

roslaunch package_name launch_file.launch # 启动launch文件

roswtf # 检查ROS环境

rosversion -d # 查看ROS版本

rosdep check package_name # 检查包依赖

rosdep update # 更新包索引

rosdep install package_name # 安装包依赖

rosnode list # 列出运行的节点
rosnode info /node_name # 查看节点信息
rosnode kill /node_name # 杀死节点

rostopic list # 列出所有话题
rostopic type /topic_name # 查看话题类型
rostopic info /topic_name # 查看话题信息
rostopic echo /topic_name # 监听话题消息
rostopic pub /topic_name std_msgs/String "data: 'Hello World'" # 发布话题消息
rostopic hz /topic_name # 查看话题频率
rostopic bw /topic_name # 查看话题带宽
rostopic delay /scan # 查看消息延迟
rostopic find sensor_msgs/LaserScan # 统计话题信息

rosservice list # 列出所有服务
rosservice type /service_name # 查看服务类型
rosservice info /service_name # 查看服务信息
rosservice call /service_name "request_data" # 调用服务
rosservice args /service_name # 查看服务参数

rosparam list # 列出所有参数
rosparam get /param_name # 获取参数值
rosparam set /param_name value # 设置参数值
rosparam delete /param_name # 删除参数
rosparam dump params.yaml # 导出参数到文件
rosparam load params.yaml # 从文件加载参数

rospack find package_name # 查找包路径
rospack depends package_name # 列出包依赖
rosls package_name # 列出包内容
roscd package_name # 进入包目录
rosed package_name file_name # 编辑包文件

rosmsg show message_type # 查看消息定义
rosmsg list # 列出消息类型
rosmsg package package_name # 查找消息类型

rossrv show service_type # 查看服务定义
rossrv list # 列出服务类型
rossrv package package_name # 查找服务类型

rosbag record -a # 记录所有话题
rosbag record /topic1 /topic2 # 记录指定话题
rosbag info bagfile.bag # 查看bag文件信息
rosbag play bagfile.bag # 回放bag文件
rosbag play -r 0.5 bagfile.bag # 慢速回放
rosbag play -l bagfile.bag # 循环回放

```

**ROS2 常用命令：**

```bash
ros2 run package_name node_name # 运行节点

ros2 --version # 查看ROS2版本

ros2 doctor # 医生诊断

rosdep check package_name # 检查包依赖

ros2 launch package_name launch_file.py # 启动launch文件

ros2 node list # 列出运行的节点
ros2 node info /node_name # 查看节点信息

ros2 topic list # 列出所有话题
ros2 topic type /topic_name # 查看话题类型
ros2 topic info /topic_name # 查看话题信息
ros2 topic echo /topic_name # 监听话题消息
ros2 topic pub /topic_name std_msgs/msg/String '{data: "Hello World"}' # 发布话题消息
ros2 topic hz /topic_name # 查看话题频率
ros2 topic bw /topic_name # 查看话题带宽

ros2 service list # 列出所有服务
ros2 service type /service_name # 查看服务类型
ros2 service call /service_name service_type "request_data" # 调用服务
ros2 service find service_type # 查找服务

ros2 param list # 列出所有参数
ros2 param get /node_name param_name # 获取参数值
ros2 param set /node_name param_name value # 设置参数值
ros2 param delete /node_name param_name # 删除参数
ros2 param dump /node_name --output-dir ./ # 导出参数

ros2 pkg create package_name # 创建包
ros2 pkg list # 列出所有包
ros2 pkg xml package_name # 查看包信息
ros2 pkg executables package_name # 查找可执行文件

ros2 bag record -a # 记录所有话题
ros2 bag record /topic1 /topic2 # 记录指定话题
ros2 bag info bagfile # 查看bag文件信息
ros2 bag play bagfile # 回放bag文件
ros2 bag play --rate 0.5 bagfile # 慢速回放
```

### 调试和分析工具

- `rqt_graph`：可视化节点与话题
- `rqt_console` 和 `rosout`：查看日志
- `rviz`：可视化传感器数据、坐标系
- `rosbag/ros2 bag`：数据录制与回放
- `tf/tf2`：查看坐标变换关系
- `roswtf`：诊断工具（ROS1）

### 消息 服务 动作

#### 消息

- 定义：
  - 消息是ROS中数据传输的基本单位
  - 定义了数据的结构和类型
  - 支持基本数据类型和复合类型
  - 可以嵌套和数组化

- 作用：
  - 节点间异步通信的载体
  - 定义了标准的数据接口
  - 支持跨语言的数据交换
  - 提供了版本兼容性机制

- 消息文件 (.msg)：
  - 消息定义存储在.msg文件中，通常位于ROS包的msg/目录下。
  - 语法： 每一行定义一个字段，格式为 数据类型 字段名。
  - 示例： my_package/msg/MyCustomMessage.msg

  ```bash
  # 定义一个简单的消息
  string header.frame_id    # 帧ID
  time header.stamp         # 时间戳
  float32 position_x
  float32 position_y
  int32 status
  bool is_valid
  ```

  - 基本数据类型： bool, byte, char, float32, float64, int8, int16, int32, int64, uint8, uint16, uint32, uint64, string, time, duration。
  - 数组： 支持定长数组 (float32[4]) 和变长数组 (float32[])。
  - 常量： 可以在消息定义中定义常量。
  - int8 CONSTANT_VALUE = 100
  - 嵌套消息： 可以包含其他ROS消息类型作为字段（如 std_msgs/Header）。

#### 服务

- 定义： 服务是ROS节点之间通过请求-响应 (Request-Response) 模式进行通信的接口。一个节点作为服务提供者，提供特定功能；另一个节点作为服务客户端，向服务提供者发送请求并等待响应。
- 作用：
  - 同步操作： 适用于需要立即得到结果的请求，例如查询地图信息、执行一次性动作等。
  - 明确的输入和输出： 有清晰的请求数据和服务响应数据。
- 服务文件 (.srv)：
  - 服务定义存储在.srv文件中，通常位于ROS包的srv/目录下。
  - 语法： 由两个消息定义组成，中间用 --- 分隔。前半部分是请求消息，后半部分是响应消息。
  - 示例： my_package/srv/AddTwoInts.srv

  ```bash
  # 请求 (Request)
  int64 a
  int64 b
  ---
  # 响应 (Response)
  int64 sum
  ```

#### 动作 (Actions) - 主要针对ROS 1 / 行为 (Behaviors) - 针对ROS 2

ROS1 Actions架构

```bash
┌─────────────────┐    ┌─────────────────┐
│  Action Client  │    │  Action Server  │
└─────────────────┘    └─────────────────┘
         │                       │
         └───────────────────────┘
              actionlib基础
         ┌─────────────────────────┐
         │   5个独立的Topic:        │
         │   - goal                │
         │   - cancel              │
         │   - status              │
         │   - feedback            │
         │   - result              │
         └─────────────────────────┘
```

---

ROS2 Behaviors架构

```bash
┌─────────────────┐    ┌─────────────────┐
│ Behavior Client │    │ Behavior Server │
└─────────────────┘    └─────────────────┘
         │                       │
         └───────────────────────┘
           rclcpp_action基础
         ┌─────────────────────────┐
         │   3个Service/Topic:     │
         │   - goal (service)      │
         │   - cancel (service)    │
         │   - feedback (topic)    │
         └─────────────────────────┘
```

---

Actions/Behaviors

- 定义： 动作是ROS 1中用于处理长时间运行任务的接口，它提供了一个目标-反馈-结果 (Goal-Feedback-Result) 的异步通信模式。
- 作用： 适用于机器人导航、机械臂抓取等需要持续反馈的任务。
- 组成： 一个动作服务器（处理任务）和一个动作客户端（发送目标、接收反馈、获取结果）。
- 动作文件 (.action)： 包含目标、结果和反馈三个部分的消息定义，由 --- 分隔。
- 示例： my_package/action/DoSomething.action

```bash
# 目标 (Goal)
int32 target_value
---
# 结果 (Result)
int32 final_value
---
# 反馈 (Feedback)
float32 current_progress
```

#### 完整demo(含编译配置)

[ros1,ros2消息,服务,动作示例](ros1,ros2消息,服务,动作示例)
