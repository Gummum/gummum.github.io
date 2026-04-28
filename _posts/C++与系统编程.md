---
title: "C++与系统编程"
date: 2026-04-17
categories:
  - C++与系统编程
---

背景 - 2024年

之前主要用C语言，C++只在一些别人提供的SDK中和刷算法题的时候使用。

公司主要用`ros1` `c++11` `c++14` `c++17` 混合开发。

为了深入学习C++开发，开了这个专栏。

本专栏的目的不只是C++,还有很多数据结构,Linux,STL,标准库,POSIX,POCO,boost等等知识也会穿插在里面。毕竟C++只是一个工具,还需要搭配具体应用场景。

[C++不同版本区别](C++不同版本区别)

[为什么条件变量要搭配互斥锁使用](为什么条件变量要搭配互斥锁使用)

[虚假唤醒](虚假唤醒)

[boost](boost)

[poco](poco)

[lambda](lambda)

使用RAII来管理资源

```c++
auto close_fd = std::unique_ptr<void, decltype(&close)>(nullptr, &close);
close_fd.reset(reinterpret_cast<void*>(static_cast<intptr_t>(fd)));
```

## 参考链接

[好用的C++库](https://juejin.cn/post/7225072417533558844)
