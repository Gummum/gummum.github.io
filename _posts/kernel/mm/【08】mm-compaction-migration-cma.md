---
title: "【08】内存碎片治理：compaction / migration / CMA（kcompactd）"
date: 2026-04-17
categories:
  - Linux
  - Kernel
  - mm
---

> 本文把 “高阶分配失败 → compaction/migration → 证据与调参” 讲清，并把 `vm.compaction_proactiveness`、`vm.extfrag_threshold` 等 sysctl 映射到源码。基线：Linux `v5.15.200`（arm64）。

## 0. 目标与边界

- 序号（1..N）：08
- 模块/主题：compaction + migrate + CMA
- Kernel：`v5.15.200`，Arch：`arm64`
- 源码树：`/Volumes/CF/code/source-code/linux-5.15.200`
- 覆盖：
  - compaction 主路径与关键数据结构
  - migrate 的失败分类（作为慢路径种子）
  - CMA 的定位与调试入口
  - sysctl 与 debugfs（extfrag）的观测与生效点
- 不覆盖：
  - reclaim 策略本体（见【06】）
  - THP/hugetlb 的策略细节（见【09】）

## 1. 设计原理

- buddy allocator 需要连续物理页块（order>0），碎片化会让高阶分配失败（见【05】）。
- compaction 通过“隔离可迁移页 → 迁移到新位置 → 形成更大连续空闲块”来恢复高阶可用块。
- trade-off：
  - compaction 会搬运页，可能引发锁竞争、TLB shootdown、CPU 消耗；
  - 被 pin 的页（GUP longterm 等）会显著降低可迁移性（与【13】交界）。

## 2. 关键数据结构详解

- `mm/compaction.c: struct compact_control`
- `mm/migrate.c`：迁移控制结构（按 `migrate_pages()` 的参数与 helper 路线追）
- pageblock/migratetype：碎片化的根源之一（建议结合 `/proc/pagetypeinfo` 读）

## 3. 核心流程源码走读

### 3.1 Happy path：高阶分配触发 compaction（概念主线）

1. `mm/page_alloc.c: alloc_pages_slowpath()`（见【05】）
2. `mm/compaction.c`：进入 compaction（如 `compact_zone()` 等）
3. 隔离页：
  - isolate freepages
  - isolate migratepages
4. `mm/migrate.c: migrate_pages()`：执行迁移
5. 形成更大连续 free block，回到分配路径满足需求

### 3.2 kcompactd：后台 compaction

- 创建点：`mm/compaction.c` 内 `kthread_run(kcompactd, ...)`（证据见 mm-evidence）
- 作用：在后台主动进行 compaction，降低前台高阶分配时的同步代价（受 sysctl 控制，见 §5）

## 4. 慢速/异常路径详解

### 4.1 迁移失败分类（你排障时最关心）

- 为什么迁移会失败：
  - 页不可迁移（migratetype/锁定/写回/引用等条件）
  - pin 导致不可移动（GUP/pinning；见【13】）
  - 内存压力下迁移与回收互相干扰
- 你需要在代码里把“失败原因 → 返回码/统计 → 可观测证据”对齐（从 `migrate_pages()` 的返回值与 tracepoints 入手）。

### 4.2 extfrag 与“看似有很多空闲页但无法满足高阶”

- 现象：`MemFree` 不低，但高阶分配仍失败
- 根因：碎片化（外部碎片），可通过 extfrag 指标/`/proc/buddyinfo` 证明

## 5. 调优参数与观测指标（映射到源码）

### 5.1 sysctl：compaction 相关关键项

- `vm.compact_memory`
  - 注册：`/Volumes/CF/code/source-code/linux-5.15.200/kernel/sysctl.c`
  - 注释/入口：`/Volumes/CF/code/source-code/linux-5.15.200/mm/compaction.c`（包含对该 sysctl 的说明）
  - 生效：手动触发 compaction（写入触发）
- `vm.compaction_proactiveness`
  - 注册：`kernel/sysctl.c`
  - 数据/handler：`mm/compaction.c: sysctl_compaction_proactiveness` + `compaction_proactiveness_sysctl_handler()`
  - 生效：后台 proactive compaction 的力度/阈值
- `vm.extfrag_threshold`
  - 注册：`kernel/sysctl.c`
  - 数据：`mm/compaction.c: sysctl_extfrag_threshold`
  - 生效：作为启发式，影响是否进行 compaction（避免做“无用功”）

### 5.2 debugfs：extfrag 指标

- 创建点：`/Volumes/CF/code/source-code/linux-5.15.200/mm/vmstat.c`（`debugfs_create_dir("extfrag", ...)`）
- 文件：
  - `extfrag/extfrag_index`
  - `extfrag/unusable_index`
- 用法：把碎片化从“感觉”变成“证据”，再决定是否该调 compaction 相关 sysctl 或调整工作负载行为。

## 6. 常见问题与源码级解释

### 6.1 症状：驱动/THP/hugetlb 需要高阶页，经常失败

1. 证据：`/proc/buddyinfo` 高 order 空闲块少；extfrag 指标高
2. 路线：`alloc_pages_slowpath()` → compaction → migrate_pages
3. 根因定位：
   - 是否大量不可迁移/被 pin 的页阻塞迁移（转【13】）
   - 是否后台 compaction 被关闭或力度不足（`vm.compaction_proactiveness`）

## 7. 分析工具箱

- **buddyinfo/pagetypeinfo/extfrag**
  - 命令：`cat /proc/buddyinfo`、`cat /proc/pagetypeinfo`、`cat /sys/kernel/debug/extfrag/extfrag_index`（路径按系统）
- **perf/ftrace：确认是否频繁 compaction**
  - 关注：`compact_zone`、`migrate_pages`、以及 vmscan 交界
- **源码导航**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n \"\\bcompact_memory\\b|\\bcompaction_proactiveness\\b|\\bextfrag_threshold\\b\" $K/kernel/sysctl.c $K/mm/compaction.c`
  - `rg -n \"\\bcompact_zone\\b|\\bmigrate_pages\\b\" $K/mm/compaction.c $K/mm/migrate.c`
  - `rg -n \"debugfs_create_dir\\(\\\"extfrag\\\"\" $K/mm/vmstat.c`

---

## 附录 I：讲解提纲包（Explain Pack）

### 30 秒定义

compaction/migration 通过搬运可迁移页来恢复连续物理页块，缓解外部碎片化导致的高阶分配失败；sysctl 与 extfrag 指标帮助你判断“该不该做、做多少、有没有效果”。

