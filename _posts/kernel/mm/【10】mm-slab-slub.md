---
title: "【10】内核小对象分配：SLUB/SLAB/SLOB、slub_debug 与 usercopy"
categories:
  - Linux
  - Kernel
  - mm
---

> 本文以 SLUB 为主线（v5.15 默认常见配置），讲清 `kmalloc/kmem_cache_alloc` 的 fast/slow path、`slub_debug` 等 boot 参数如何生效、以及常用观测面（/proc/slabinfo、kmem tracepoints、KASAN/KFENCE）。基线：Linux `v5.15.200`（arm64）。

## 0. 目标与边界

- 序号（1..N）：10
- 模块/主题：slab 家族（SLUB/SLAB/SLOB）+ debug 与安全检查（usercopy）
- Kernel：`v5.15.200`，Arch：`arm64`
- 源码树：`/Volumes/CF/code/source-code/linux-5.15.200`
- 覆盖：
  - SLUB：`mm/slub.c` 主路径
  - slab common：`mm/slab_common.c`
  - usercopy 硬化：`mm/usercopy.c`
  - boot params：`slub_debug`、`slub_min_order`、`slub_max_order`、`slub_min_objects`
- 不覆盖：
  - buddy allocator 细节（见【05】）
  - memcg slab 计费的细节（与【11】交界，按需补充）

## 1. 设计原理

- 需求：内核频繁分配小对象（几十字节到几 KB），如果每次都走页分配器（buddy）会太慢、碎片更严重。
- slab 的思路：按对象大小/类型建立 cache（`struct kmem_cache`），把页切成对象，复用构造成本，优化缓存局部性，并提供调试/硬化能力。

## 2. 关键数据结构详解

- `include/linux/slab_def.h` / 相关头文件：`struct kmem_cache`
- SLUB 的 slab/page 元数据（按 `mm/slub.c` 访问点追）
- usercopy 白名单/边界检查对象（`mm/usercopy.c`）

## 3. 核心流程源码走读

### 3.1 Happy path：`kmem_cache_alloc()` fast path（SLUB）

1. `mm/slub.c`：`kmem_cache_alloc()`（或其内联/包装）
2. `mm/slub.c: ___slab_alloc()`：从 per-cpu freelist 取对象（fast）
3. 返回对象指针

### 3.2 Slow path：需要 new slab/page

1. fast path 没对象
2. 分配新 slab page（会向下走 buddy，交界见【05】）
3. 初始化 freelist，回到 fast path 返回对象

## 4. 慢速/异常路径详解

### 4.1 `slub_debug` 开启后的开销与价值

- 价值：poison/redzone 等帮助定位 UAF/越界写；与 KASAN/KFENCE 配合能更快收敛根因
- 代价：分配/释放更慢，占用更多内存
- 核心：要把“开销换定位速度”的 trade-off 讲清，并给出建议启用策略（线上/复现环境）。

### 4.2 usercopy 检测失败

- 现象：日志报错或直接触发 BUG（取决于配置），通常意味着“拷贝的范围越界或类型不匹配”
- 根因落点：`mm/usercopy.c` 的检查路径 + 调用方的 copy_to/from_user 逻辑

## 5. 调优参数与观测指标（映射到源码）

### 5.1 boot params（SLUB）

- `slub_debug`
  - 注册：`/Volumes/CF/code/source-code/linux-5.15.200/mm/slub.c: __setup("slub_debug", setup_slub_debug)`
  - 生效：影响 SLUB 调试特性开关与对象/页的处理方式
- `slub_min_order`
  - 注册：`mm/slub.c: __setup("slub_min_order=", setup_slub_min_order)`
- `slub_max_order`
  - 注册：`mm/slub.c: __setup("slub_max_order=", setup_slub_max_order)`
- `slub_min_objects`
  - 注册：`mm/slub.c: __setup("slub_min_objects=", setup_slub_min_objects)`

### 5.2 /proc：slabinfo

- 创建点：`/Volumes/CF/code/source-code/linux-5.15.200/mm/slab_common.c`（`proc_create("slabinfo", ...)`）
- 用途：定位哪个 cache 占用最大、对象数与碎片情况（但需理解字段含义，避免误判）。

### 5.3 kmem tracepoints（分配/释放事件）

- 定义位置常在：`/Volumes/CF/code/source-code/linux-5.15.200/include/trace/events/kmem.h`
- 用途：把“谁在分配”与“分配频率/大小分布”证据化。

## 6. 常见问题与源码级解释

### 6.1 症状：slab 占用巨大（疑似内核内存泄漏）

1. 证据：`slabtop` / `/proc/slabinfo` 某 cache 持续增长
2. 定位：
   - 哪个子系统在 alloc？
   - 是否有对象生命周期未释放？
3. 工具：
   - kmem tracepoints / perf
   - kmemleak（若可用）
4. 源码落点：对应 cache 创建点（`kmem_cache_create`）与持有者

## 7. 分析工具箱

- **slabtop / slabinfo**
  - 命令：`slabtop`、`cat /proc/slabinfo | head`
- **KASAN / KFENCE / kmemleak**
  - 用途：收敛 UAF/越界/泄漏的根因（按构建配置启用）
- **源码导航**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n \"__setup\\(\\\"slub_debug\\\"|__setup\\(\\\"slub_min_order=\\\"|__setup\\(\\\"slub_max_order=\\\"|__setup\\(\\\"slub_min_objects=\\\"\" $K/mm/slub.c`
  - `rg -n \"proc_create\\(\\\"slabinfo\\\"\" $K/mm/slab_common.c`
  - `rg -n \"TRACE_EVENT\\(kmalloc|TRACE_EVENT\\(kfree\" $K/include/trace/events/kmem.h`

---

## 附录 I：讲解提纲包（Explain Pack）

### 30 秒定义

slab 分配器通过按对象类型/大小建立 cache，把页切成对象并复用元数据，以更低锁竞争与更好局部性满足内核小对象分配；SLUB 提供一系列 boot 参数与调试/硬化机制（slub_debug、usercopy）来在性能与可诊断性间做权衡。

