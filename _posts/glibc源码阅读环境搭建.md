---
title: "glibc源码阅读环境搭建"
categories:
  - 通用
---

## 确定要看哪个版本

确定要看哪个版本，最好产品用的是哪个版本。不一定要看pc的

```bash
 /lib/libc.so.6
GNU C Library (GNU) release release version 2.33.
Copyright (C) 2021 Free Software Foundation, Inc.
This is free software; see the source for copying conditions.
There is NO warranty; not even for MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE.
Compiled by GNU CC version 10.3.1 20210621.
libc ABIs: UNIQUE ABSOLUTE
For bug reporting instructions, please see:
<https://bugs.linaro.org/>.
```

用的是2.33的

## 下载依赖

```bash
sudo apt update
sudo apt install build-essential manpages-dev gawk git bison python3 texinfo \
    gcc-multilib g++-multilib libtool make autoconf automake bear
```

## 下载源码

```bash
git clone https://sourceware.org/git/glibc.git
cd glibc
```

切换到对应版本的分支

```bash
release/2.33/master
```

## 创建build目录

```bash
mkdir -p ../glibc-build
cd ../glibc-build
```

### 配置交叉编译环境

注：考虑到可能有一些平台差异，所以交叉编译后。生成的compile_commands.json会方便看arm架构的。

```bash
export TOOLCHAIN=xxxxx #根据自己的交叉编译目录来
export SYSROOT=xxxxx #根据自己的头文件目录来
export INSTALL_DIR=$PWD/glibc-install
```
### 配置configure

注：

- 至少要开O1编译才能过
- 有些有警告报成错误的用--disable-werror 开o2可以避免

```bash
../configure   --host=aarch64-none-linux-gnu   --prefix=$INSTALL_DIR   --with-headers=$SYSROOT/usr/include  --disable-werror CC=$TOOLCHAIN/aarch64-none-linux-gnu-gcc CXX=$TOOLCHAIN/aarch64-none-linux-gnu-g++   CFLAGS="-O1 -g"

bear make -j4
cp compile_commands.json ../
```

重启vscode窗口

发现clangd 在建立索引即成功了.

