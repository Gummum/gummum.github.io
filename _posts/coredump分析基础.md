---
title: "coredump分析基础"
categories:
  - coredump分析
---

最直接的就是先把一个栈回溯打印出来。看看哪里不懂，再往这方面学习。

当程序崩溃时，coredump文件为我们提供了宝贵的调试信息。通过分析coredump，我们可以快速定位程序崩溃的原因。本文将系统性地介绍coredump分析的六个关键要素，并结合实际案例进行详细讲解。

## 示例栈回溯

让我们先看一个实际的栈回溯信息：

```bash
/application/bin/hesai_driver received signal 6
/application/bin/hesai_driver() [0x416e40]
linux-vdso.so.1(__kernel_rt_sigreturn+0) [0x7f8947f790]
/lib/libc.so.6(gsignal+0xcc) [0x7f88aa8d4c]
/lib/libc.so.6(abort+0xe0) [0x7f88a961f8]
/lib/libstdc++.so.6(_ZN9__gnu_cxx27__verbose_terminate_handlerEv+0x188) [0x7f88d62018]
/lib/libstdc++.so.6(+0xa6b4c) [0x7f88d5fb4c]
/lib/libstdc++.so.6(+0xa6bb0) [0x7f88d5fbb0]
/lib/libstdc++.so.6(__cxa_rethrow+0) [0x7f88d5fea0]
/opt/lib/librostime.so(_ZN3ros8TimeBaseINS_4TimeENS_8DurationEE7fromSecEd+0x160) [0x7f891f8fc0]
/application/bin/hesai_driver(_ZN5hesai11DataFetcher12onPointsDataERKNS_12CloudPackageE+0x2ec) [0x41df4c]
/application/bin/hesai_driver(_ZN5hesai11DataFetcher12processFrameEPKhi+0x504) [0x41f4c8]
/application/bin/hesai_driver(_ZN5hesai11DataFetcher11processDataEPKhi+0x170) [0x421ef0]
/application/bin/hesai_driver() [0x422300]
/lib/libstdc++.so.6(+0xd1a0c) [0x7f88d8aa0c]
/lib/libpthread.so.0(+0x6df8) [0x7f892f2df8]
/lib/libc.so.6(+0xcd51c) [0x7f88b4251c]
```

接下来，我们将从六个维度来分析这个栈回溯。

## 信号

信号是Unix/Linux系统中进程间通信的一种机制，当程序出现异常时，内核会向进程发送相应的信号。

### 常见信号类型

- **SIGABRT (6)**: 程序异常终止，通常由`abort()`函数调用
- **SIGSEGV (11)**: 段错误，访问了无效内存地址
- **SIGFPE (8)**: 浮点异常，如除零错误
- **SIGILL (4)**: 非法指令
- **SIGBUS (7)**: 总线错误，通常是内存对齐问题

### 案例分析

在我们的示例中：

``` bash
/application/bin/hesai_driver received signal 6
```

**Signal 6 (SIGABRT)** 表示程序主动调用了`abort()`函数或者发生了严重的运行时错误。从栈回溯可以看到：

- `gsignal+0xcc` - 发送信号的系统调用
- `abort+0xe0` - 调用abort函数
- `__verbose_terminate_handlerEv` - C++异常处理机制

说明程序遇到了未捕获的C++异常，导致程序主动终止

## 栈回溯

栈回溯（Stack Trace）显示了程序崩溃时的函数调用链，从最底层的系统调用到最顶层的应用函数。

### 如何读取栈回溯？

栈回溯应该**从下往上**读取，因为它反映了函数调用的顺序：

1. **最底层**：系统调用和库函数
2. **中间层**：第三方库函数
3. **最顶层**：应用程序函数

### 栈回溯案例分析

让我们分析示例的调用链（从下往上）：

``` bash
/lib/libc.so.6(+0xcd51c)           # 线程入口点
/lib/libpthread.so.0(+0x6df8)      # pthread线程函数
/lib/libstdc++.so.6(+0xd1a0c)      # C++标准库
/application/bin/hesai_driver()     # 应用程序入口
hesai::DataFetcher::processData()   # 数据处理函数
hesai::DataFetcher::processFrame()  # 帧处理函数
hesai::DataFetcher::onPointsData()  # 点云数据处理 ← 问题可能在这里
ros::TimeBase::fromSec()            # ROS时间转换函数
__cxa_rethrow                       # C++异常重新抛出
```

**关键发现**：问题很可能出现在`onPointsData`函数中，该函数调用了ROS的时间转换函数，触发了异常。

## 函数命名(Name Mangling)

### 什么是Name Mangling？

Name Mangling（名称修饰/名称重整）是编译器将C++中的函数名、变量名等标识符转换为唯一符号名的过程。这是为了支持C++的以下特性：

1. **函数重载**（Function Overloading）
2. **命名空间**（Namespaces）
3. **类和成员函数**
4. **模板**（Templates）
5. **操作符重载**

### 为什么需要Name Mangling？

C语言的链接器只能处理简单的符号名，不支持重载。C++需要将复杂的标识符转换为唯一的符号，以便：

- 区分重载函数
- 保持类型安全
- 支持链接时的符号解析

### GCC/Clang (Itanium ABI)

> MSVC 的 Name Mangling 规则不同，这里不做介绍

**基本规则：**

- 以`_Z`开头
- 使用长度前缀编码字符串
- 嵌套名称用`N...E`包围

**常见编码：**

``` text
基本类型：
i - int
l - long
f - float
d - double
c - char
b - bool
v - void
修饰符：
P - 指针 (pointer)
R - 引用 (reference)
K - const
V - volatile
特殊：
S_ - 对之前符号的引用
St - std命名空间
```

``` c++
// 原始函数
void func(int, double);
// 修饰后: _Z4funcid

// 类成员函数
class MyClass {
    void method(int x);
};
// 修饰后: _ZN7MyClass6methodEi

// 模板函数
template<typename T>
void templateFunc(T value);
// 实例化为int: _Z12templateFuncIiEvT_
```

### 具体例子分析

让我们逐步分解这个符号：
`_ZN5hesai11DataFetcher12onPointsDataERKNS_12CloudPackageE+0x2ec`

#### 符号结构分解

1. **`_Z`** - 这是GCC/Clang编译器的名称修饰前缀，表示这是一个修饰过的C++符号

2. **`N`** - 表示嵌套名称（nested name）的开始

3. **`5hesai`** - 命名空间名称
   - `5` 表示接下来的字符串长度为5
   - `hesai` 是命名空间的名称

4. **`11DataFetcher`** - 类名
   - `11` 表示接下来的字符串长度为11
   - `DataFetcher` 是类的名称

5. **`12onPointsData`** - 方法名
   - `12` 表示接下来的字符串长度为12
   - `onPointsData` 是方法的名称

6. **`E`** - 嵌套名称的结束标记

7. **`RK`** - 参数类型修饰符
   - `R` 表示引用（reference）
   - `K` 表示const

8. **`NS_12CloudPackageE`** - 参数类型
   - `N` 开始新的嵌套名称
   - `S_` 表示对之前出现过的命名空间的引用（这里指hesai）
   - `12CloudPackage` 表示类名CloudPackage（长度12）
   - `E` 结束嵌套名称

9. **`+0x2ec`** - 这不是名称修饰的一部分，而是地址偏移量

#### 还原后的C++代码

```cpp
namespace hesai {
    class DataFetcher {
        void onPointsData(const hesai::CloudPackage& package);
    };
}
```

### 详细的Itanium ABI编码规则

```text
_Z <encoding>
```

```text
<encoding> := <function name> <bare-function-type>
           := <data name>
           := <special-name>
```

```text
<name> := <nested-name>
       := <unscoped-name>
       := <unscoped-template-name> <template-args>
       := <local-name>

<nested-name> := N [<CV-qualifiers>] <prefix> <unqualified-name> E
              := N [<CV-qualifiers>] <template-prefix> <template-args> E

<prefix> := <prefix> <unqualified-name>
         := <template-prefix> <template-args>
         := <template-param>
         := <substitution>
         := # empty

<unqualified-name> := <operator-name>
                   := <ctor-dtor-name>
                   := <source-name>
                   := <unnamed-type-name>

<source-name> := <positive length number> <identifier>
```

```text
<type> := <builtin-type>
       := <function-type>
       := <class-enum-type>
       := <array-type>
       := <pointer-to-member-type>
       := <template-param>
       := <template-template-param> <template-args>
       := <substitution>
       := <CV-qualifiers> <type>
       := P <type>    # pointer-to
       := R <type>    # reference-to
       := O <type>    # rvalue reference-to (C++0x)
       := C <type>    # complex pair (C 2000)
       := G <type>    # imaginary (C 2000)
       := U <source-name> <type>  # vendor extended type qualifier
```

#### 复杂示例分析

示例1：模板函数

```c++
template<typename T, int N>
void process(T data[N]);

// 实例化：process<int, 10>
// 修饰后：_Z7processIiLi10EEvPT_
```

分解：

- _Z - 前缀
- 7process - 函数名（长度7）
- I...E - 模板参数列表
- i - int类型
- Li10E - 字面量整数10
- v - 返回类型void
- PT_ - 指向模板参数T的指针
示例2：复杂类成员函数

```c++
namespace ns {
    template<typename T>
    class Container {
    public:
        const T& get(size_t index) const;
    };
}

// 实例化：ns::Container<std::string>::get(size_t) const
// 修饰后：_ZNK2ns9ContainerISsE3getEm
```

分解：

- _Z - 前缀
- N...E - 嵌套名称
- K - const成员函数
- 2ns - 命名空间ns
- 9Container - 类名Container
- ISsE - 模板参数std::string（Ss是std::string的缩写）
- 3get - 方法名get
- m - size_t参数（在64位系统上通常是unsigned long）

### Name Mangling的实际应用

`c++filt` `objdump` `nm` `addr2line`

```base
# 使用c++filt反修饰符号
echo "_ZN5hesai11DataFetcher12onPointsDataERKNS_12CloudPackageE" | c++filt
# 输出：hesai::DataFetcher::onPointsData(hesai::CloudPackage const&)

# 使用objdump查看符号表
objdump -t myprogram.o | c++filt

# 使用nm查看符号
nm myprogram.o | c++filt
```

## 4. 地址

### 地址的含义

栈回溯中的地址信息包含两部分：

- **基地址**：库或程序加载的起始地址
- **偏移量**：函数在库中的相对位置

### 地址格式解析

```
/lib/libc.so.6(gsignal+0xcc) [0x7f88aa8d4c]
```

- `gsignal+0xcc`：函数名+偏移量
- `[0x7f88aa8d4c]`：绝对内存地址

### 如何使用地址信息？

1. **addr2line工具**：将地址转换为源代码行号

```bash
addr2line -e /application/bin/hesai_driver 0x41df4c
```

2. **objdump工具**：反汇编查看具体指令

```bash
objdump -d /application/bin/hesai_driver | grep -A 10 -B 10 41df4c
```

### 案例分析

关键地址分析：

- `0x41df4c` - `onPointsData`函数中的具体位置
- `0x41f4c8` - `processFrame`函数中的位置
- `0x7f891f8fc0` - ROS库中`fromSec`函数的位置

这些地址可以帮助我们精确定位到出错的代码行。

## 5. 程序

### 程序信息的重要性

程序路径告诉我们：

- 可执行文件的位置
- 程序的名称和版本
- 是否是调试版本

### 案例分析

```
/application/bin/hesai_driver
```

**分析**：

- 这是一个激光雷达驱动程序（hesai是一家激光雷达厂商）
- 位于`/application/bin/`目录，说明是应用程序
- 程序名暗示这是处理激光雷达数据的驱动

### 调试信息检查

检查程序是否包含调试信息：

```bash
file /application/bin/hesai_driver
readelf -S /application/bin/hesai_driver | grep debug
```

如果包含调试信息，我们可以获得更详细的错误定位。

## 6. 库名

### 库的分类

从栈回溯中我们可以看到几类库：

1. **系统库**：
   - `/lib/libc.so.6` - C标准库
   - `/lib/libpthread.so.0` - POSIX线程库
   - `/lib/libstdc++.so.6` - C++标准库

2. **系统特殊库**：
   - `linux-vdso.so.1` - 虚拟动态共享对象

3. **第三方库**：
   - `/opt/lib/librostime.so` - ROS时间库

### 库版本和兼容性

库的版本信息对于问题诊断很重要：

```bash
ldd /application/bin/hesai_driver  # 查看依赖库
objdump -p /application/bin/hesai_driver | grep NEEDED  # 查看需要的库
```

### 案例分析

**关键库分析**：

1. **librostime.so**：
   - 这是ROS（Robot Operating System）的时间处理库
   - 错误发生在`fromSec`函数中，可能是时间转换时的数值问题

2. **libstdc++.so.6**：
   - C++标准库处理了异常
   - `__cxa_rethrow`表明有异常被重新抛出

3. **libc.so.6**：
   - 最终调用了`abort()`函数终止程序

## 综合分析与调试建议

### 问题定位

基于以上分析，问题的根本原因很可能是：

1. **时间数据异常**：传递给`ros::TimeBase::fromSec()`的double值可能是无效的（如NaN、无穷大等）
2. **内存问题**：`CloudPackage`对象可能包含损坏的数据
3. **线程安全问题**：多线程环境下的数据竞争

### 调试步骤

1. **生成coredump**：

```bash
ulimit -c unlimited  # 允许生成coredump
echo "core.%p" > /proc/sys/kernel/core_pattern
```

2. **使用GDB分析**：

```bash
gdb /application/bin/hesai_driver core.12345
(gdb) bt  # 查看栈回溯
(gdb) info registers  # 查看寄存器状态
(gdb) x/10i $pc  # 查看崩溃时的指令
```

3. **检查变量值**：

```bash
(gdb) frame 10  # 切换到onPointsData函数
(gdb) print *this  # 查看对象状态
(gdb) print package  # 查看CloudPackage内容
```

### 预防措施

1. **输入验证**：在调用`fromSec()`前检查时间值的有效性
2. **异常处理**：添加适当的try-catch块
3. **日志记录**：在关键函数中添加调试日志
4. **单元测试**：针对边界条件编写测试用例

## 总结

Coredump分析是一个系统性的过程，需要综合考虑信号、栈回溯、函数命名、地址、程序和库等多个维度的信息。通过本文的分析方法，我们可以快速定位程序崩溃的根本原因，并制定相应的修复策略。

记住，coredump分析不仅仅是技术问题的解决，更是对程序运行机制深入理解的过程。掌握这些技能将大大提高我们的调试效率和程序质量。
