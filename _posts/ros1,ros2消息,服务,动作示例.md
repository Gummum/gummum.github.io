---
title: "ros1,ros2消息,服务,动作示例"
categories:
  - ros
---

一个完整的机器人控制系统，包含自定义消息、服务和动作/行为的实现。

## 项目结构

```bash
robot_example/
├── msg/
│   ├── RobotStatus.msg
│   ├── SensorData.msg
│   └── BatteryInfo.msg
├── srv/
│   ├── SetMode.srv
│   └── GetRobotInfo.srv
├── action/
│   ├── NavigateToGoal.action
│   └── PickAndPlace.action
├── src/
│   ├── robot_controller.cpp (ROS1)
│   ├── robot_controller_ros2.cpp (ROS2)
│   ├── robot_client.cpp (ROS1)
│   └── robot_client_ros2.cpp (ROS2)
├── CMakeLists.txt
├── package.xml
└── README.md
```

## 消息定义

### msg/RobotStatus.msg

```bash
# 机器人状态消息
string robot_id
int32 mode              # 0=idle, 1=moving, 2=working, 3=charging
geometry_msgs/Pose current_pose
BatteryInfo battery
SensorData sensors
float32 speed
bool is_emergency_stop
time last_update
```

### msg/BatteryInfo.msg

```bash
# 电池信息
float32 voltage         # 电压 (V)
float32 current         # 电流 (A)
float32 percentage      # 电量百分比 (0-100)
float32 temperature     # 温度 (℃)
bool is_charging
int32 estimated_runtime # 预估运行时间 (秒)
```

### msg/SensorData.msg

```bash
# 传感器数据
Header header
float32[] laser_ranges     # 激光雷达数据
geometry_msgs/Twist imu    # IMU数据
float32 temperature        # 环境温度
float32 humidity          # 湿度
bool[] obstacle_detected  # 障碍物检测 [前,后,左,右]
```

## 服务定义

### srv/SetMode.srv

```bash
# 设置机器人模式
int32 mode              # 目标模式
string parameters       # 额外参数
---
bool success
string message
int32 previous_mode
```

### srv/GetRobotInfo.srv

```bash
# 获取机器人信息
string robot_id
---
RobotStatus status
string[] available_modes
float32 uptime
string firmware_version
bool success
```

## 动作/行为定义

### action/NavigateToGoal.action

```bash
# 导航到目标点
geometry_msgs/Pose target_pose
float32 max_speed
bool avoid_obstacles
---
bool success
geometry_msgs/Pose final_pose
float32 total_distance
float32 total_time
string result_message
---
geometry_msgs/Pose current_pose
float32 distance_remaining
float32 estimated_time_remaining
float32 current_speed
int32 progress_percentage
```

### action/PickAndPlace.action

```bash
# 抓取和放置物体
string object_id
geometry_msgs/Pose pick_pose
geometry_msgs/Pose place_pose
float32 gripper_force
---
bool success
string result_message
geometry_msgs/Pose actual_pick_pose
geometry_msgs/Pose actual_place_pose
---
string current_phase    # "approaching", "picking", "lifting", "moving", "placing"
int32 progress_percentage
geometry_msgs/Pose current_pose
```

## ROS1实现

### 编译配置 - CMakeLists.txt (ROS1)

```cmake
cmake_minimum_required(VERSION 3.0.2)
project(robot_example)

# 查找依赖包
find_package(catkin REQUIRED COMPONENTS
  roscpp
  rospy
  std_msgs
  geometry_msgs
  sensor_msgs
  message_generation
  actionlib_msgs
  actionlib
)

# 添加消息文件
add_message_files(
  FILES
  RobotStatus.msg
  BatteryInfo.msg
  SensorData.msg
)

# 添加服务文件
add_service_files(
  FILES
  SetMode.srv
  GetRobotInfo.srv
)

# 添加动作文件
add_action_files(
  FILES
  NavigateToGoal.action
  PickAndPlace.action
)

# 生成消息
generate_messages(
  DEPENDENCIES
  std_msgs
  geometry_msgs
  sensor_msgs
  actionlib_msgs
)

# catkin包配置
catkin_package(
  CATKIN_DEPENDS
    message_runtime
    std_msgs
    geometry_msgs
    sensor_msgs
    actionlib_msgs
    actionlib
)

# 包含目录
include_directories(
  ${catkin_INCLUDE_DIRS}
)

# 构建可执行文件
add_executable(robot_controller src/robot_controller.cpp)
add_executable(robot_client src/robot_client.cpp)

# 链接库
target_link_libraries(robot_controller ${catkin_LIBRARIES})
target_link_libraries(robot_client ${catkin_LIBRARIES})

# 添加依赖
add_dependencies(robot_controller ${${PROJECT_NAME}_EXPORTED_TARGETS} ${catkin_EXPORTED_TARGETS})
add_dependencies(robot_client ${${PROJECT_NAME}_EXPORTED_TARGETS} ${catkin_EXPORTED_TARGETS})
```

### package.xml (ROS1)

```xml
<?xml version="1.0"?>
<package format="2">
  <name>robot_example</name>
  <version>1.0.0</version>
  <description>Complete ROS example with messages, services, and actions</description>
  
  <maintainer email="developer@example.com">Developer</maintainer>
  <license>MIT</license>

  <buildtool_depend>catkin</buildtool_depend>
  
  <build_depend>roscpp</build_depend>
  <build_depend>rospy</build_depend>
  <build_depend>std_msgs</build_depend>
  <build_depend>geometry_msgs</build_depend>
  <build_depend>sensor_msgs</build_depend>
  <build_depend>message_generation</build_depend>
  <build_depend>actionlib_msgs</build_depend>
  <build_depend>actionlib</build_depend>

  <exec_depend>roscpp</exec_depend>
  <exec_depend>rospy</exec_depend>
  <exec_depend>std_msgs</exec_depend>
  <exec_depend>geometry_msgs</exec_depend>
  <exec_depend>sensor_msgs</exec_depend>
  <exec_depend>message_runtime</exec_depend>
  <exec_depend>actionlib_msgs</exec_depend>
  <exec_depend>actionlib</exec_depend>
</package>
```

### ROS1 机器人控制器实现

```cpp
// src/robot_controller.cpp
#include <ros/ros.h>
#include <actionlib/server/simple_action_server.h>
#include "robot_example/RobotStatus.h"
#include "robot_example/SetMode.h"
#include "robot_example/GetRobotInfo.h"
#include "robot_example/NavigateToGoalAction.h"
#include "robot_example/PickAndPlaceAction.h"

class RobotController {
private:
    ros::NodeHandle nh_;
    
    // 发布器
    ros::Publisher status_pub_;
    
    // 服务服务器
    ros::ServiceServer set_mode_srv_;
    ros::ServiceServer get_info_srv_;
    
    // 动作服务器
    actionlib::SimpleActionServer<robot_example::NavigateToGoalAction> nav_as_;
    actionlib::SimpleActionServer<robot_example::PickAndPlaceAction> pick_as_;
    
    // 机器人状态
    robot_example::RobotStatus robot_status_;
    int current_mode_;
    std::string robot_id_;

public:
    RobotController() : 
        nav_as_(nh_, "navigate_to_goal", 
                boost::bind(&RobotController::executeNavigation, this, _1), false),
        pick_as_(nh_, "pick_and_place", 
                 boost::bind(&RobotController::executePickAndPlace, this, _1), false) {
        
        robot_id_ = "robot_001";
        current_mode_ = 0; // idle
        
        // 初始化发布器
        status_pub_ = nh_.advertise<robot_example::RobotStatus>("robot_status", 10);
        
        // 初始化服务
        set_mode_srv_ = nh_.advertiseService("set_mode", 
            &RobotController::setModeCallback, this);
        get_info_srv_ = nh_.advertiseService("get_robot_info", 
            &RobotController::getRobotInfoCallback, this);
        
        // 启动动作服务器
        nav_as_.start();
        pick_as_.start();
        
        // 初始化机器人状态
        initializeRobotStatus();
        
        ROS_INFO("Robot Controller initialized with ID: %s", robot_id_.c_str());
    }
    
    void initializeRobotStatus() {
        robot_status_.robot_id = robot_id_;
        robot_status_.mode = current_mode_;
        robot_status_.current_pose.position.x = 0.0;
        robot_status_.current_pose.position.y = 0.0;
        robot_status_.current_pose.position.z = 0.0;
        robot_status_.speed = 0.0;
        robot_status_.is_emergency_stop = false;
        
        // 初始化电池信息
        robot_status_.battery.voltage = 24.0;
        robot_status_.battery.current = 2.0;
        robot_status_.battery.percentage = 85.0;
        robot_status_.battery.temperature = 25.0;
        robot_status_.battery.is_charging = false;
        robot_status_.battery.estimated_runtime = 3600;
        
        // 初始化传感器数据
        robot_status_.sensors.header.frame_id = "base_link";
        robot_status_.sensors.laser_ranges = {1.0, 1.5, 2.0, 1.2};
        robot_status_.sensors.temperature = 22.0;
        robot_status_.sensors.humidity = 45.0;
        robot_status_.sensors.obstacle_detected = {false, false, false, false};
    }
    
    bool setModeCallback(robot_example::SetMode::Request& req,
                        robot_example::SetMode::Response& res) {
        ROS_INFO("Setting robot mode to: %d", req.mode);
        
        if (req.mode >= 0 && req.mode <= 3) {
            res.previous_mode = current_mode_;
            current_mode_ = req.mode;
            robot_status_.mode = current_mode_;
            res.success = true;
            res.message = "Mode changed successfully";
        } else {
            res.success = false;
            res.message = "Invalid mode. Valid modes: 0-3";
        }
        
        return true;
    }
    
    bool getRobotInfoCallback(robot_example::GetRobotInfo::Request& req,
                             robot_example::GetRobotInfo::Response& res) {
        ROS_INFO("Robot info requested for ID: %s", req.robot_id.c_str());
        
        if (req.robot_id == robot_id_) {
            res.status = robot_status_;
            res.available_modes = {"idle", "moving", "working", "charging"};
            res.uptime = ros::Time::now().toSec();
            res.firmware_version = "1.2.3";
            res.success = true;
        } else {
            res.success = false;
        }
        
        return true;
    }
    
    void executeNavigation(const robot_example::NavigateToGoalGoalConstPtr& goal) {
        ROS_INFO("Starting navigation to target pose");
        
        ros::Rate rate(10);
        robot_example::NavigateToGoalFeedback feedback;
        robot_example::NavigateToGoalResult result;
        
        // 模拟导航过程
        double total_distance = 10.0;
        double start_time = ros::Time::now().toSec();
        
        for (int i = 0; i <= 100; ++i) {
            if (nav_as_.isPreemptRequested() || !ros::ok()) {
                ROS_INFO("Navigation preempted");
                nav_as_.setPreempted();
                return;
            }
            
            // 更新反馈
            feedback.distance_remaining = total_distance * (100 - i) / 100.0;
            feedback.estimated_time_remaining = feedback.distance_remaining / goal->max_speed;
            feedback.current_speed = goal->max_speed;
            feedback.progress_percentage = i;
            feedback.current_pose.position.x = i * 0.1;
            feedback.current_pose.position.y = i * 0.05;
            
            nav_as_.publishFeedback(feedback);
            
            // 更新机器人状态
            robot_status_.current_pose = feedback.current_pose;
            robot_status_.speed = feedback.current_speed;
            robot_status_.mode = 1; // moving
            
            rate.sleep();
        }
        
        // 设置结果
        result.success = true;
        result.final_pose = goal->target_pose;
        result.total_distance = total_distance;
        result.total_time = ros::Time::now().toSec() - start_time;
        result.result_message = "Navigation completed successfully";
        
        robot_status_.mode = 0; // idle
        robot_status_.speed = 0.0;
        
        ROS_INFO("Navigation completed successfully");
        nav_as_.setSucceeded(result);
    }
    
    void executePickAndPlace(const robot_example::PickAndPlaceGoalConstPtr& goal) {
        ROS_INFO("Starting pick and place operation for object: %s", goal->object_id.c_str());
        
        ros::Rate rate(10);
        robot_example::PickAndPlaceFeedback feedback;
        robot_example::PickAndPlaceResult result;
        
        std::vector<std::string> phases = {"approaching", "picking", "lifting", "moving", "placing"};
        
        for (size_t phase = 0; phase < phases.size(); ++phase) {
            for (int progress = 0; progress <= 100; progress += 10) {
                if (pick_as_.isPreemptRequested() || !ros::ok()) {
                    ROS_INFO("Pick and place preempted");
                    pick_as_.setPreempted();
                    return;
                }
                
                feedback.current_phase = phases[phase];
                feedback.progress_percentage = (phase * 100 + progress) / phases.size();
                
                // 根据阶段更新位置
                if (phase < 2) {
                    feedback.current_pose = goal->pick_pose;
                } else {
                    feedback.current_pose = goal->place_pose;
                }
                
                pick_as_.publishFeedback(feedback);
                robot_status_.mode = 2; // working
                
                rate.sleep();
            }
        }
        
        // 设置结果
        result.success = true;
        result.result_message = "Pick and place completed successfully";
        result.actual_pick_pose = goal->pick_pose;
        result.actual_place_pose = goal->place_pose;
        
        robot_status_.mode = 0; // idle
        
        ROS_INFO("Pick and place completed successfully");
        pick_as_.setSucceeded(result);
    }
    
    void publishStatus() {
        robot_status_.last_update = ros::Time::now();
        status_pub_.publish(robot_status_);
    }
    
    void spin() {
        ros::Rate rate(1); // 1Hz
        while (ros::ok()) {
            publishStatus();
            ros::spinOnce();
            rate.sleep();
        }
    }
};

int main(int argc, char** argv) {
    ros::init(argc, argv, "robot_controller");
    
    RobotController robot;
    robot.spin();
    
    return 0;
}
```

### ROS1 客户端实现

```cpp
// src/robot_client.cpp
#include <ros/ros.h>
#include <actionlib/client/simple_action_client.h>
#include "robot_example/RobotStatus.h"
#include "robot_example/SetMode.h"
#include "robot_example/GetRobotInfo.h"
#include "robot_example/NavigateToGoalAction.h"

typedef actionlib::SimpleActionClient<robot_example::NavigateToGoalAction> NavigationClient;

class RobotClient {
private:
    ros::NodeHandle nh_;
    ros::Subscriber status_sub_;
    ros::ServiceClient set_mode_client_;
    ros::ServiceClient get_info_client_;
    std::unique_ptr<NavigationClient> nav_client_;

public:
    RobotClient() {
        // 初始化订阅器
        status_sub_ = nh_.subscribe("robot_status", 10, 
            &RobotClient::statusCallback, this);
        
        // 初始化服务客户端
        set_mode_client_ = nh_.serviceClient<robot_example::SetMode>("set_mode");
        get_info_client_ = nh_.serviceClient<robot_example::GetRobotInfo>("get_robot_info");
        
        // 初始化动作客户端
        nav_client_.reset(new NavigationClient("navigate_to_goal", true));
        
        ROS_INFO("Robot Client initialized");
    }
    
    void statusCallback(const robot_example::RobotStatus::ConstPtr& msg) {
        ROS_INFO_THROTTLE(5, "Robot %s - Mode: %d, Speed: %.2f, Battery: %.1f%%", 
                         msg->robot_id.c_str(), msg->mode, msg->speed, 
                         msg->battery.percentage);
    }
    
    bool setRobotMode(int mode) {
        robot_example::SetMode srv;
        srv.request.mode = mode;
        srv.request.parameters = "";
        
        if (set_mode_client_.call(srv)) {
            ROS_INFO("Mode change result: %s", srv.response.message.c_str());
            return srv.response.success;
        } else {
            ROS_ERROR("Failed to call set_mode service");
            return false;
        }
    }
    
    void getRobotInfo() {
        robot_example::GetRobotInfo srv;
        srv.request.robot_id = "robot_001";
        
        if (get_info_client_.call(srv)) {
            if (srv.response.success) {
                ROS_INFO("Robot Info - Firmware: %s, Uptime: %.1f", 
                         srv.response.firmware_version.c_str(), 
                         srv.response.uptime);
            } else {
                ROS_WARN("Robot not found");
            }
        } else {
            ROS_ERROR("Failed to call get_robot_info service");
        }
    }
    
    void navigateToGoal(double x, double y) {
        ROS_INFO("Waiting for navigation server...");
        nav_client_->waitForServer();
        
        robot_example::NavigateToGoalGoal goal;
        goal.target_pose.position.x = x;
        goal.target_pose.position.y = y;
        goal.target_pose.position.z = 0.0;
        goal.max_speed = 1.0;
        goal.avoid_obstacles = true;
        
        ROS_INFO("Sending navigation goal to (%.2f, %.2f)", x, y);
        nav_client_->sendGoal(goal,
            boost::bind(&RobotClient::navigationDone, this, _1, _2),
            NavigationClient::SimpleActiveCallback(),
            boost::bind(&RobotClient::navigationFeedback, this, _1));
    }
    
    void navigationDone(const actionlib::SimpleClientGoalState& state,
                       const robot_example::NavigateToGoalResultConstPtr& result) {
        ROS_INFO("Navigation finished: %s", state.toString().c_str());
        if (result->success) {
            ROS_INFO("Distance: %.2f, Time: %.2f", 
                     result->total_distance, result->total_time);
        }
    }
    
    void navigationFeedback(const robot_example::NavigateToGoalFeedbackConstPtr& feedback) {
        ROS_INFO_THROTTLE(2, "Navigation progress: %d%%, Distance remaining: %.2f", 
                         feedback->progress_percentage, feedback->distance_remaining);
    }
    
    void testAllFeatures() {
        ros::Duration(2.0).sleep(); // 等待连接建立
        
        // 测试服务
        getRobotInfo();
        setRobotMode(1); // 设置为moving模式
        
        // 测试动作
        navigateToGoal(5.0, 3.0);
        
        // 等待动作完成
        nav_client_->waitForResult();
        
        setRobotMode(0); // 设置回idle模式
    }
};

int main(int argc, char** argv) {
    ros::init(argc, argv, "robot_client");
    
    RobotClient client;
    client.testAllFeatures();
    
    ros::spin();
    return 0;
}
```

## ROS2实现

### 编译配置 - CMakeLists.txt (ROS2)

```cmake
cmake_minimum_required(VERSION 3.8)
project(robot_example)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# 查找依赖包
find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rclcpp_action REQUIRED)
find_package(std_msgs REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(action_msgs REQUIRED)
find_package(rosidl_default_generators REQUIRED)

# 生成接口文件
rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/RobotStatus.msg"
  "msg/BatteryInfo.msg"
  "msg/SensorData.msg"
  "srv/SetMode.srv"
  "srv/GetRobotInfo.srv"
  "action/NavigateToGoal.action"
  "action/PickAndPlace.action"
  DEPENDENCIES std_msgs geometry_msgs sensor_msgs action_msgs
)

# 构建可执行文件
add_executable(robot_controller_ros2 src/robot_controller_ros2.cpp)
add_executable(robot_client_ros2 src/robot_client_ros2.cpp)

ament_target_dependencies(robot_controller_ros2 
  rclcpp rclcpp_action std_msgs geometry_msgs sensor_msgs)
ament_target_dependencies(robot_client_ros2 
  rclcpp rclcpp_action std_msgs geometry_msgs sensor_msgs)

# 链接生成的接口
rosidl_target_interfaces(robot_controller_ros2 ${PROJECT_NAME} "rosidl_typesupport_cpp")
rosidl_target_interfaces(robot_client_ros2 ${PROJECT_NAME} "rosidl_typesupport_cpp")

# 安装
install(TARGETS
  robot_controller_ros2
  robot_client_ros2
  DESTINATION lib/${PROJECT_NAME}
)

# 安装其他文件
install(DIRECTORY launch DESTINATION share/${PROJECT_NAME}/)

ament_package()
```

### package.xml (ROS2)

```xml
<?xml version="1.0"?>
<?xml-model href="http://download.ros.org/schema/package_format3.xsd" schematypens="http://www.w3.org/2001/XMLSchema"?>
<package format="3">
  <name>robot_example</name>
  <version>1.0.0</version>
  <description>Complete ROS2 example with messages, services, and actions</description>
  <maintainer email="developer@example.com">Developer</maintainer>
  <license>MIT</license>

  <buildtool_depend>ament_cmake</buildtool_depend>
  <buildtool_depend>rosidl_default_generators</buildtool_depend>

  <depend>rclcpp</depend>
  <depend>rclcpp_action</depend>
  <depend>std_msgs</depend>
  <depend>geometry_msgs</depend>
  <depend>sensor_msgs</depend>
  <depend>action_msgs</depend>

  <exec_depend>rosidl_default_runtime</exec_depend>

  <member_of_group>rosidl_interface_packages</member_of_group>

  <export>
    <build_type>ament_cmake</build_type>
  </export>
</package>
```

### ROS2 机器人控制器实现

```cpp
// src/robot_controller_ros2.cpp
#include <functional>
#include <memory>
#include <thread>
#include <chrono>

#include "rclcpp/rclcpp.hpp"
#include "rclcpp_action/rclcpp_action.hpp"
#include "robot_example/msg/robot_status.hpp"
#include "robot_example/srv/set_mode.hpp"
#include "robot_example/srv/get_robot_info.hpp"
#include "robot_example/action/navigate_to_goal.hpp"
#include "robot_example/action/pick_and_place.hpp"

using namespace std::chrono_literals;

class RobotController : public rclcpp::Node {
public:
    using NavigateToGoal = robot_example::action::NavigateToGoal;
    using PickAndPlace = robot_example::action::PickAndPlace;
    using GoalHandleNav = rclcpp_action::ServerGoalHandle<NavigateToGoal>;
    using GoalHandlePick = rclcpp_action::ServerGoalHandle<PickAndPlace>;

    RobotController() : Node("robot_controller"), robot_id_("robot_001"), current_mode_(0) {
        // 发布器
        status_pub_ = this->create_publisher<robot_example::msg::RobotStatus>(
            "robot_status", 10);

        // 服务服务器
        set_mode_srv_ = this->create_service<robot_example::srv::SetMode>(
            "set_mode", std::bind(&RobotController::setModeCallback, this,
            std::placeholders::_1, std::placeholders::_2));
        
        get_info_srv_ = this->create_service<robot_example::srv::GetRobotInfo>(
            "get_robot_info", std::bind(&RobotController::getRobotInfoCallback, this,
            std::placeholders::_1, std::placeholders::_2));

        // 动作服务器
        nav_action_server_ = rclcpp_action::create_server<NavigateToGoal>(
            this, "navigate_to_goal",
            std::bind(&RobotController::handleNavGoal, this, std::placeholders::_1, std::placeholders::_2),
            std::bind(&RobotController::handleNavCancel, this, std::placeholders::_1),
            std::bind(&RobotController::handleNavAccepted, this, std::placeholders::_1));

        pick_action_server_ = rclcpp_action::create_server<PickAndPlace>(
            this, "pick_and_place",
            std::bind(&RobotController::handlePickGoal, this, std::placeholders::_1, std::placeholders::_2),
            std::bind(&RobotController::handlePickCancel, this, std::placeholders::_1),
            std::bind(&RobotController::handlePickAccepted, this, std::placeholders::_1));

        // 状态发布定时器
        timer_ = this->create_wall_timer(1s, std::bind(&RobotController::publishStatus, this));

        initializeRobotStatus();
        RCLCPP_INFO(this->get_logger(), "Robot Controller initialized with ID: %s", robot_id_.c_str());
    }

private:
    // 成员变量
    std::string robot_id_;
    int32_t current_mode_;
    robot_example::msg::RobotStatus robot_status_;

    // ROS2组件
    rclcpp::Publisher<robot_example::msg::RobotStatus>::SharedPtr status_pub_;
    rclcpp::Service<robot_example::srv::SetMode>::SharedPtr set_mode_srv_;
    rclcpp::Service<robot_example::srv::GetRobotInfo>::SharedPtr get_info_srv_;
    rclcpp_action::Server<NavigateToGoal>::SharedPtr nav_action_server_;
    rclcpp_action::Server<PickAndPlace>::SharedPtr pick_action_server_;
    rclcpp::TimerBase::SharedPtr timer_;

    void initializeRobotStatus() {
        robot_status_.robot_id = robot_id_;
        robot_status_.mode = current_mode_;
        robot_status_.current_pose.position.x = 0.0;
        robot_status_.current_pose.position.y = 0.0;
        robot_status_.current_pose.position.z = 0.0;
        robot_status_.speed = 0.0;
        robot_status_.is_emergency_stop = false;

        // 初始化电池信息
        robot_status_.battery.voltage = 24.0;
        robot_status_.battery.current = 2.0;
        robot_status_.battery.percentage = 85.0;
        robot_status_.battery.temperature = 25.0;
        robot_status_.battery.is_charging = false;
        robot_status_.battery.estimated_runtime = 3600;

        // 初始化传感器数据
        robot_status_.sensors.header.frame_id = "base_link";
        robot_status_.sensors.laser_ranges = {1.0, 1.5, 2.0, 1.2};
        robot_status_.sensors.temperature = 22.0;
        robot_status_.sensors.humidity = 45.0;
        robot_status_.sensors.obstacle_detected = {false, false, false, false};
    }

    void setModeCallback(
        const std::shared_ptr<robot_example::srv::SetMode::Request> request,
        std::shared_ptr<robot_example::srv::SetMode::Response> response) {
        
        RCLCPP_INFO(this->get_logger(), "Setting robot mode to: %d", request->mode);
        
        if (request->mode >= 0 && request->mode <= 3) {
            response->previous_mode = current_mode_;
            current_mode_ = request->mode;
            robot_status_.mode = current_mode_;
            response->success = true;
            response->message = "Mode changed successfully";
        } else {
            response->success = false;
            response->message = "Invalid mode. Valid modes: 0-3";
        }
    }

    void getRobotInfoCallback(
        const std::shared_ptr<robot_example::srv::GetRobotInfo::Request> request,
        std::shared_ptr<robot_example::srv::GetRobotInfo::Response> response) {
        
        RCLCPP_INFO(this->get_logger(), "Robot info requested for ID: %s", request->robot_id.c_str());
        
        if (request->robot_id == robot_id_) {
            response->status = robot_status_;
            response->available_modes = {"idle", "moving", "working", "charging"};
            response->uptime = this->get_clock()->now().seconds();
            response->firmware_version = "1.2.3";
            response->success = true;
        } else {
            response->success = false;
        }
    }

    // 导航动作处理
    rclcpp_action::GoalResponse handleNavGoal(
        const rclcpp_action::GoalUUID & uuid,
        std::shared_ptr<const NavigateToGoal::Goal> goal) {
        
        RCLCPP_INFO(this->get_logger(), "Received navigation goal request");
        (void)uuid;
        return rclcpp_action::GoalResponse::ACCEPT_AND_EXECUTE;
    }

    rclcpp_action::CancelResponse handleNavCancel(
        const std::shared_ptr<GoalHandleNav> goal_handle) {
        
        RCLCPP_INFO(this->get_logger(), "Received request to cancel navigation");
        (void)goal_handle;
        return rclcpp_action::CancelResponse::ACCEPT;
    }

    void handleNavAccepted(const std::shared_ptr<GoalHandleNav> goal_handle) {
        // 在新线程中执行导航
        std::thread{std::bind(&RobotController::executeNavigation, this, goal_handle)}.detach();
    }

    void executeNavigation(const std::shared_ptr<GoalHandleNav> goal_handle) {
        RCLCPP_INFO(this->get_logger(), "Starting navigation execution");
        
        const auto goal = goal_handle->get_goal();
        auto feedback = std::make_shared<NavigateToGoal::Feedback>();
        auto result = std::make_shared<NavigateToGoal::Result>();
        
        // 模拟导航过程
        double total_distance = 10.0;
        auto start_time = this->get_clock()->now();
        
        for (int i = 0; i <= 100; ++i) {
            if (goal_handle->is_canceling()) {
                result->success = false;
                result->result_message = "Navigation was cancelled";
                goal_handle->canceled(result);
                RCLCPP_INFO(this->get_logger(), "Navigation cancelled");
                return;
            }
            
            // 更新反馈
            feedback->distance_remaining = total_distance * (100 - i) / 100.0;
            feedback->estimated_time_remaining = feedback->distance_remaining / goal->max_speed;
            feedback->current_speed = goal->max_speed;
            feedback->progress_percentage = i;
            feedback->current_pose.position.x = i * 0.1;
            feedback->current_pose.position.y = i * 0.05;
            
            goal_handle->publish_feedback(feedback);
            
            // 更新机器人状态
            robot_status_.current_pose = feedback->current_pose;
            robot_status_.speed = feedback->current_speed;
            robot_status_.mode = 1; // moving
            
            std::this_thread::sleep_for(100ms);
        }
        
        // 设置结果
        result->success = true;
        result->final_pose = goal->target_pose;
        result->total_distance = total_distance;
        result->total_time = (this->get_clock()->now() - start_time).seconds();
        result->result_message = "Navigation completed successfully";
        
        robot_status_.mode = 0; // idle
        robot_status_.speed = 0.0;
        
        goal_handle->succeed(result);
        RCLCPP_INFO(this->get_logger(), "Navigation completed successfully");
    }

    // 抓取放置动作处理
    rclcpp_action::GoalResponse handlePickGoal(
        const rclcpp_action::GoalUUID & uuid,
        std::shared_ptr<const PickAndPlace::Goal> goal) {
        
        RCLCPP_INFO(this->get_logger(), "Received pick and place goal for object: %s", 
                   goal->object_id.c_str());
        (void)uuid;
        return rclcpp_action::GoalResponse::ACCEPT_AND_EXECUTE;
    }

    rclcpp_action::CancelResponse handlePickCancel(
        const std::shared_ptr<GoalHandlePick> goal_handle) {
        
        RCLCPP_INFO(this->get_logger(), "Received request to cancel pick and place");
        (void)goal_handle;
        return rclcpp_action::CancelResponse::ACCEPT;
    }

    void handlePickAccepted(const std::shared_ptr<GoalHandlePick> goal_handle) {
        // 在新线程中执行抓取放置
        std::thread{std::bind(&RobotController::executePickAndPlace, this, goal_handle)}.detach();
    }

    void executePickAndPlace(const std::shared_ptr<GoalHandlePick> goal_handle) {
        RCLCPP_INFO(this->get_logger(), "Starting pick and place execution");
        
        const auto goal = goal_handle->get_goal();
        auto feedback = std::make_shared<PickAndPlace::Feedback>();
        auto result = std::make_shared<PickAndPlace::Result>();
        
        std::vector<std::string> phases = {"approaching", "picking", "lifting", "moving", "placing"};
        
        for (size_t phase = 0; phase < phases.size(); ++phase) {
            for (int progress = 0; progress <= 100; progress += 10) {
                if (goal_handle->is_canceling()) {
                    result->success = false;
                    result->result_message = "Pick and place was cancelled";
                    goal_handle->canceled(result);
                    RCLCPP_INFO(this->get_logger(), "Pick and place cancelled");
                    return;
                }
                
                feedback->current_phase = phases[phase];
                feedback->progress_percentage = (phase * 100 + progress) / phases.size();
                
                // 根据阶段更新位置
                if (phase < 2) {
                    feedback->current_pose = goal->pick_pose;
                } else {
                    feedback->current_pose = goal->place_pose;
                }
                
                goal_handle->publish_feedback(feedback);
                robot_status_.mode = 2; // working
                
                std::this_thread::sleep_for(100ms);
            }
        }
        
        // 设置结果
        result->success = true;
        result->result_message = "Pick and place completed successfully";
        result->actual_pick_pose = goal->pick_pose;
        result->actual_place_pose = goal->place_pose;
        
        robot_status_.mode = 0; // idle
        
        goal_handle->succeed(result);
        RCLCPP_INFO(this->get_logger(), "Pick and place completed successfully");
    }

    void publishStatus() {
        robot_status_.last_update = this->get_clock()->now();
        status_pub_->publish(robot_status_);
    }
};

int main(int argc, char * argv[]) {
    rclcpp::init(argc, argv);
    rclcpp::spin(std::make_shared<RobotController>());
    rclcpp::shutdown();
    return 0;
}
```

### ROS2 机器人客户端实现

```cpp
// src/robot_client_ros2.cpp - 完整版本
#include <functional>
#include <memory>
#include <chrono>
#include <future>

#include "rclcpp/rclcpp.hpp"
#include "rclcpp_action/rclcpp_action.hpp"
#include "robot_example/msg/robot_status.hpp"
#include "robot_example/srv/set_mode.hpp"
#include "robot_example/srv/get_robot_info.hpp"
#include "robot_example/action/navigate_to_goal.hpp"
#include "robot_example/action/pick_and_place.hpp"

using namespace std::chrono_literals;

class RobotClient : public rclcpp::Node {
public:
    using NavigateToGoal = robot_example::action::NavigateToGoal;
    using PickAndPlace = robot_example::action::PickAndPlace;
    using GoalHandleNav = rclcpp_action::ClientGoalHandle<NavigateToGoal>;
    using GoalHandlePick = rclcpp_action::ClientGoalHandle<PickAndPlace>;

    RobotClient() : Node("robot_client") {
        // 初始化订阅器
        status_sub_ = this->create_subscription<robot_example::msg::RobotStatus>(
            "robot_status", 10, std::bind(&RobotClient::statusCallback, this, std::placeholders::_1));

        // 初始化服务客户端
        set_mode_client_ = this->create_client<robot_example::srv::SetMode>("set_mode");
        get_info_client_ = this->create_client<robot_example::srv::GetRobotInfo>("get_robot_info");

        // 初始化动作客户端
        nav_action_client_ = rclcpp_action::create_client<NavigateToGoal>(this, "navigate_to_goal");
        pick_action_client_ = rclcpp_action::create_client<PickAndPlace>(this, "pick_and_place");

        RCLCPP_INFO(this->get_logger(), "Robot Client initialized");
    }

    void statusCallback(const robot_example::msg::RobotStatus::SharedPtr msg) {
        static auto last_log_time = this->get_clock()->now();
        auto current_time = this->get_clock()->now();
        
        // 每5秒打印一次状态信息
        if ((current_time - last_log_time).seconds() >= 5.0) {
            RCLCPP_INFO(this->get_logger(), 
                       "Robot %s - Mode: %d, Speed: %.2f, Battery: %.1f%%",
                       msg->robot_id.c_str(), msg->mode, msg->speed, 
                       msg->battery.percentage);
            last_log_time = current_time;
        }
    }

    bool setRobotMode(int32_t mode) {
        // 等待服务可用
        while (!set_mode_client_->wait_for_service(1s)) {
            if (!rclcpp::ok()) {
                RCLCPP_ERROR(this->get_logger(), "Client interrupted while waiting for service");
                return false;
            }
            RCLCPP_INFO(this->get_logger(), "Waiting for set_mode service...");
        }

        auto request = std::make_shared<robot_example::srv::SetMode::Request>();
        request->mode = mode;
        request->parameters = "";

        auto result_future = set_mode_client_->async_send_request(request);
        
        // 等待结果
        if (rclcpp::spin_until_future_complete(this->get_node_base_interface(), result_future) ==
            rclcpp::FutureReturnCode::SUCCESS) {
            auto result = result_future.get();
            RCLCPP_INFO(this->get_logger(), "Mode change result: %s", result->message.c_str());
            return result->success;
        } else {
            RCLCPP_ERROR(this->get_logger(), "Failed to call set_mode service");
            return false;
        }
    }

    void getRobotInfo() {
        // 等待服务可用
        while (!get_info_client_->wait_for_service(1s)) {
            if (!rclcpp::ok()) {
                RCLCPP_ERROR(this->get_logger(), "Client interrupted while waiting for service");
                return;
            }
            RCLCPP_INFO(this->get_logger(), "Waiting for get_robot_info service...");
        }

        auto request = std::make_shared<robot_example::srv::GetRobotInfo::Request>();
        request->robot_id = "robot_001";

        auto result_future = get_info_client_->async_send_request(request);
        
        // 等待结果
        if (rclcpp::spin_until_future_complete(this->get_node_base_interface(), result_future) ==
            rclcpp::FutureReturnCode::SUCCESS) {
            auto result = result_future.get();
            if (result->success) {
                RCLCPP_INFO(this->get_logger(), 
                           "Robot Info - Firmware: %s, Uptime: %.1f",
                           result->firmware_version.c_str(), result->uptime);
            } else {
                RCLCPP_WARN(this->get_logger(), "Robot not found");
            }
        } else {
            RCLCPP_ERROR(this->get_logger(), "Failed to call get_robot_info service");
        }
    }

    void navigateToGoal(double x, double y) {
        // 等待动作服务器
        if (!nav_action_client_->wait_for_action_server(10s)) {
            RCLCPP_ERROR(this->get_logger(), "Navigation action server not available");
            return;
        }

        auto goal_msg = NavigateToGoal::Goal();
        goal_msg.target_pose.position.x = x;
        goal_msg.target_pose.position.y = y;
        goal_msg.target_pose.position.z = 0.0;
        goal_msg.max_speed = 1.0;
        goal_msg.avoid_obstacles = true;

        RCLCPP_INFO(this->get_logger(), "Sending navigation goal to (%.2f, %.2f)", x, y);

        auto send_goal_options = rclcpp_action::Client<NavigateToGoal>::SendGoalOptions();
        send_goal_options.goal_response_callback = 
            std::bind(&RobotClient::navGoalResponseCallback, this, std::placeholders::_1);
        send_goal_options.feedback_callback = 
            std::bind(&RobotClient::navFeedbackCallback, this, std::placeholders::_1, std::placeholders::_2);
        send_goal_options.result_callback = 
            std::bind(&RobotClient::navResultCallback, this, std::placeholders::_1);

        nav_action_client_->async_send_goal(goal_msg, send_goal_options);
    }

    void navGoalResponseCallback(std::shared_future<GoalHandleNav::SharedPtr> future) {
        auto goal_handle = future.get();
        if (!goal_handle) {
            RCLCPP_ERROR(this->get_logger(), "Navigation goal was rejected by server");
        } else {
            RCLCPP_INFO(this->get_logger(), "Navigation goal accepted by server, waiting for result");
        }
    }

    void navFeedbackCallback(
        GoalHandleNav::SharedPtr,
        const std::shared_ptr<const NavigateToGoal::Feedback> feedback) {
        
        static auto last_feedback_time = this->get_clock()->now();
        auto current_time = this->get_clock()->now();
        
        // 每2秒打印一次反馈信息
        if ((current_time - last_feedback_time).seconds() >= 2.0) {
            RCLCPP_INFO(this->get_logger(), 
                       "Navigation progress: %d%%, Distance remaining: %.2f",
                       feedback->progress_percentage, feedback->distance_remaining);
            last_feedback_time = current_time;
        }
    }

    void navResultCallback(const GoalHandleNav::WrappedResult & result) {
        switch (result.code) {
            case rclcpp_action::ResultCode::SUCCEEDED:
                RCLCPP_INFO(this->get_logger(), "Navigation succeeded!");
                if (result.result->success) {
                    RCLCPP_INFO(this->get_logger(), 
                               "Distance: %.2f, Time: %.2f",
                               result.result->total_distance, result.result->total_time);
                }
                break;
            case rclcpp_action::ResultCode::ABORTED:
                RCLCPP_ERROR(this->get_logger(), "Navigation was aborted");
                break;
            case rclcpp_action::ResultCode::CANCELED:
                RCLCPP_ERROR(this->get_logger(), "Navigation was canceled");
                break;
            default:
                RCLCPP_ERROR(this->get_logger(), "Unknown navigation result code");
                break;
        }
    }

    void pickAndPlace(const std::string& object_id, double pick_x, double pick_y, 
                     double place_x, double place_y) {
        // 等待动作服务器
        if (!pick_action_client_->wait_for_action_server(10s)) {
            RCLCPP_ERROR(this->get_logger(), "Pick and place action server not available");
            return;
        }

        auto goal_msg = PickAndPlace::Goal();
        goal_msg.object_id = object_id;
        goal_msg.pick_pose.position.x = pick_x;
        goal_msg.pick_pose.position.y = pick_y;
        goal_msg.pick_pose.position.z = 0.0;
        goal_msg.place_pose.position.x = place_x;
        goal_msg.place_pose.position.y = place_y;
        goal_msg.place_pose.position.z = 0.0;
        goal_msg.gripper_force = 10.0;

        RCLCPP_INFO(this->get_logger(), "Sending pick and place goal for object: %s", object_id.c_str());

        auto send_goal_options = rclcpp_action::Client<PickAndPlace>::SendGoalOptions();
        send_goal_options.goal_response_callback = 
            std::bind(&RobotClient::pickGoalResponseCallback, this, std::placeholders::_1);
        send_goal_options.feedback_callback = 
            std::bind(&RobotClient::pickFeedbackCallback, this, std::placeholders::_1, std::placeholders::_2);
        send_goal_options.result_callback = 
            std::bind(&RobotClient::pickResultCallback, this, std::placeholders::_1);

        pick_action_client_->async_send_goal(goal_msg, send_goal_options);
    }

    void pickGoalResponseCallback(std::shared_future<GoalHandlePick::SharedPtr> future) {
        auto goal_handle = future.get();
        if (!goal_handle) {
            RCLCPP_ERROR(this->get_logger(), "Pick and place goal was rejected by server");
        } else {
            RCLCPP_INFO(this->get_logger(), "Pick and place goal accepted by server, waiting for result");
        }
    }

    void pickFeedbackCallback(
        GoalHandlePick::SharedPtr,
        const std::shared_ptr<const PickAndPlace::Feedback> feedback) {
        
        static auto last_feedback_time = this->get_clock()->now();
        auto current_time = this->get_clock()->now();
        
        // 每2秒打印一次反馈信息
        if ((current_time - last_feedback_time).seconds() >= 2.0) {
            RCLCPP_INFO(this->get_logger(), 
                       "Pick and place progress: %s - %d%%",
                       feedback->current_phase.c_str(), feedback->progress_percentage);
            last_feedback_time = current_time;
        }
    }

    void pickResultCallback(const GoalHandlePick::WrappedResult & result) {
        switch (result.code) {
            case rclcpp_action::ResultCode::SUCCEEDED:
                RCLCPP_INFO(this->get_logger(), "Pick and place succeeded!");
                RCLCPP_INFO(this->get_logger(), "Result: %s", result.result->result_message.c_str());
                break;
            case rclcpp_action::ResultCode::ABORTED:
                RCLCPP_ERROR(this->get_logger(), "Pick and place was aborted");
                break;
            case rclcpp_action::ResultCode::CANCELED:
                RCLCPP_ERROR(this->get_logger(), "Pick and place was canceled");
                break;
            default:
                RCLCPP_ERROR(this->get_logger(), "Unknown pick and place result code");
                break;
        }
    }

    void testAllFeatures() {
        // 等待一段时间确保连接建立
        rclcpp::sleep_for(2s);

        // 测试服务
        RCLCPP_INFO(this->get_logger(), "Testing robot services...");
        getRobotInfo();
        setRobotMode(1); // 设置为moving模式

        // 测试导航动作
        RCLCPP_INFO(this->get_logger(), "Testing navigation action...");
        navigateToGoal(5.0, 3.0);
        
        // 等待导航完成
        rclcpp::sleep_for(15s);

        // 测试抓取放置动作
        RCLCPP_INFO(this->get_logger(), "Testing pick and place action...");
        pickAndPlace("cube_001", 2.0, 1.0, 4.0, 2.0);
        
        // 等待抓取放置完成
        rclcpp::sleep_for(15s);

        setRobotMode(0); // 设置回idle模式
        RCLCPP_INFO(this->get_logger(), "All tests completed!");
    }

private:
    // 订阅器和客户端
    rclcpp::Subscription<robot_example::msg::RobotStatus>::SharedPtr status_sub_;
    rclcpp::Client<robot_example::srv::SetMode>::SharedPtr set_mode_client_;
    rclcpp::Client<robot_example::srv::GetRobotInfo>::SharedPtr get_info_client_;
    rclcpp_action::Client<NavigateToGoal>::SharedPtr nav_action_client_;
    rclcpp_action::Client<PickAndPlace>::SharedPtr pick_action_client_;
};

int main(int argc, char * argv[]) {
    rclcpp::init(argc, argv);
    
    auto client = std::make_shared<RobotClient>();
    
    // 启动测试
    std::thread test_thread([&client]() {
        client->testAllFeatures();
    });
    
    rclcpp::spin(client);
    
    if (test_thread.joinable()) {
        test_thread.join();
    }
    
    rclcpp::shutdown();
    return 0;
}
```
