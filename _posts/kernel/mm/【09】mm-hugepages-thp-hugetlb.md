---
title: "【09】Huge Pages：THP（transparent hugepage）与 hugetlb"
date: 2026-04-17
categories:
  - Linux
  - Kernel
  - mm
---

> 本文对比 THP 与 hugetlb 两套“大页”机制，给出关键入口、后台线程、慢路径（split/collapse/预留不足）以及 `transparent_hugepage=` 的 boot 参数映射。基线：Linux `v5.15.200`（arm64）。

## 0. 目标与边界

- 序号（1..N）：09
- 模块/主题：THP + khugepaged + hugetlb
- Kernel：`v5.15.200`，Arch：`arm64`
- 源码树：`/Volumes/CF/code/source-code/linux-5.15.200`
- 覆盖：
  - THP：`mm/huge_memory.c`
  - khugepaged：`mm/khugepaged.c`
  - hugetlb：`mm/hugetlb.c`（fault/预留/释放的关键路径）
  - boot 参数：`transparent_hugepage=`
- 不覆盖：
  - compaction/migrate 的机制细节（见【08】）
  - 页表/TLB 机制细节（见【02】）

## 1. 设计原理

- THP：在尽量“对应用透明”的前提下，用更大粒度的映射减少 TLB miss、提升吞吐；代价是 collapse/split 的复杂度与尾延迟风险。
- hugetlb：显式的 hugepage 池（预留/管理），提供更强的确定性与隔离；代价是配置与碎片化/预留不足带来的运维成本。

## 2. 关键数据结构详解（种子）

- THP：PMD 级别映射相关结构与标志位（与页表层交界，按 `huge_memory.c` 的访问点追）
- hugetlb：hstate / hugepage pool（`mm/hugetlb.c`）

## 3. 核心流程源码走读

### 3.1 THP boot 参数解析

- 解析函数：`/Volumes/CF/code/source-code/linux-5.15.200/mm/huge_memory.c: setup_transparent_hugepage()`
- 注册：`mm/huge_memory.c: __setup("transparent_hugepage=", setup_transparent_hugepage)`
- 生效：影响 THP 的 enable/defrag 等模式（具体 sysfs 与策略在文章中补齐）

### 3.2 khugepaged（后台 collapse）

- 线程：`mm/khugepaged.c`（证据见 mm-evidence）
- 主线：周期扫描候选 VMA/页，尝试 collapse 成大页（与 compaction/migrate 强交叉，见【08】）

### 3.3 hugetlb fault（显式 hugepage）

- 入口：`/Volumes/CF/code/source-code/linux-5.15.200/mm/hugetlb.c: hugetlb_fault()`
- 主线（概念种子）：
  1. 判断 VMA 是否为 hugetlb 映射
  2. 从 hugepage pool 取页（预留/计费检查）
  3. 建立大页映射（与【02】交界）

## 4. 慢速/异常路径详解

### 4.1 THP split 尾延迟

- 触发条件：
  - 权限/写入导致的拆分需求
  - reclaim/compaction 需要把 THP 拆成小页以便迁移/回收
- 证据链：perf 栈出现 split 相关函数；tracepoints/统计显示 split 次数激增
- 排障要点：把“谁触发 split”与“split 在什么上下文发生（前台/后台）”钉死，否则很难做取舍。

### 4.2 hugetlb 预留不足/配置不当

- 现象：`hugetlb_fault` 失败、映射失败，或运行时无法满足 hugepage 需求
- 根因：池大小、NUMA 分布、预留策略与实际负载不匹配

## 5. 调优参数与观测指标（映射到源码）

- boot：`transparent_hugepage=`（见 §3.1）
- sysfs（常见路径，具体以系统为准）：
  - `/sys/kernel/mm/transparent_hugepage/*`
  - `/sys/kernel/mm/hugepages/hugepages-*/nr_hugepages`（hugetlb 池）
- 观测：
  - `/proc/vmstat` 的 THP 相关计数（建议在文章中映射到更新点）

## 6. 常见问题与源码级解释

### 6.1 症状：尾延迟尖刺，怀疑 THP split/collapse

1. 先证据化：perf 栈 +（可能的）tracepoint 统计 split/collapse
2. 再定位触发源：fault/reclaim/compaction 哪条路径在触发
3. 根因落点：`mm/huge_memory.c`、`mm/khugepaged.c`、与 `mm/compaction.c` 的交界

## 7. 分析工具箱

- **perf**
  - 关注：`hugetlb_fault`、THP split/collapse 相关栈
- **ftrace**
  - 验证：khugepaged 主循环与关键分支
- **源码导航**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n \"__setup\\(\\\"transparent_hugepage=\\\"|setup_transparent_hugepage\" $K/mm/huge_memory.c`
  - `rg -n \"\\bhugetlb_fault\\b\" $K/mm/hugetlb.c`
  - `rg -n \"\\bkhugepaged\\b\" $K/mm/khugepaged.c`

---

## 附录 I：讲解提纲包（Explain Pack）

### 30 秒定义

THP 试图在不改应用的前提下用大页提升性能，但会引入 split/collapse 的复杂慢路径；hugetlb 用显式 hugepage 池提供确定性与隔离，代价是配置/预留/分布管理复杂度。

