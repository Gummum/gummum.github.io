# Linux v5.15.200 (arm64) — mm 子系统写作地图（【01】..【13】）

本目录用于沉淀 **Linux 内核 mm 子系统**的系列文章。目标读者是“有一定内核/系统编程基础”的工程师：文章必须强调**调用路径（call route）**、**关键数据结构**、**关键函数走读**、以及遇到问题时如何**快速切入源码定位根因**。

基线环境（所有 agent 写作时必须对齐）：

- Kernel tree：`/Volumes/CF/code/source-code/linux-5.15.200`
- Kernel version：`v5.15.200`（文章中可进一步细化到 commit/tag）
- Arch：`arm64`（涉及页表/TLB/fault 等必须落到 `arch/arm64/mm/*`）
- 系列编号：`【01】..【13】`（只用数字序号，不写 “Day X”）

---

## 全局写作协议（硬性约束）

### 命名与输出位置

- 每篇文章标题必须以 `【NN】` 开头（NN=01..12），并建议文件名同样带前缀（例如 `【03】mm-page-fault.md`）。
- 文章放置目录：`/Volumes/CF/code/gummum.github.io/_posts/kernel/mm/`

### 固定章节（每篇必须包含 a–g，建议使用 `##` 二级标题）

a. **设计原理**：为什么需要该机制；关键 trade-off；与其它方案对比；演进/迭代历史（解释“现在为什么是这样”）。  
b. **关键数据结构详解**：列出相关结构体清单；字段含义；生命周期；所有权；并发/锁。  
c. **核心流程源码走读**：至少 1 条 happy path；关键函数“逐步/逐行式”讲解（优先“伪代码步骤 + 源码位置”，避免大段贴源码）。  
d. **慢速/异常路径详解**：失败分支、回退路径、重试、超时、资源不足（ENOMEM/碎片化/锁竞争）等。  
e. **调优参数与观测指标**：/proc、sysctl、debugfs、tracepoints、counters；每个都要映射到“源码哪里读取/哪里生效”。  
f. **常见问题与源码级解释**：症状 → 证据（观测）→ 路径定位 → 根因（结构体字段/分支/竞态）→ 修复/规避。  
g. **分析工具箱**：按场景组织（能回答什么问题 → 最小命令 → 关键输出怎么读 → 如何落到源码）。  

### 固定附录（默认必须包含）

为提升“讲得明白/讲得成体系”的表达能力，每篇文章默认还必须包含：

- **附录 I：讲解提纲包（Explain Pack）**（30 秒定义、3–5 分钟白板提纲、高频追问、trade-off 表、v5.15 演进视角）

### 源码引用规则（强制）

- 每次提到关键函数/结构体，必须附带源码路径：`path/to/file.c: func()`（行号可选）。
- 贴代码片段建议 `< 25 行`；超过则用“伪代码步骤 + 关键分支解释 + 函数/文件定位”替代。
- 每篇至少给出：
  - 1 条 **happy path** call route（6–15 个节点）
  - 1 条 **slow/failure path** call route（至少 6 个节点）
- 每篇至少 1 张 Mermaid 图（flowchart/sequence/call graph 任选）。

---

## mm 拆分原则（可操作化）

### 设计原则（为什么这样拆）

1. **按主对象 + 生命周期 + 关键锁/上下文切分**  
   每个模块必须有明确的核心数据结构与不变量（例如 `mm_struct/vma`、`struct page/zone`、`lruvec`、`swap_entry`、`mem_cgroup`），并能明确“谁持有/何时释放/在哪个上下文访问/用什么锁保护”。

2. **按入口点/关键路径/后台线程切分**  
   syscall 路径、fault 路径、后台守护线程（`kswapd/kcompactd/khugepaged`）各自成块。一个模块内的主路径应能画出稳定的“route map”，便于问题发生时直接从入口切入源码。

3. **按调优面与观测面切分**  
   一个模块应能列出相对独立的一组 knobs（Kconfig/boot params/sysctl/module params/debugfs/sysfs/procfs）与指标（/proc、tracepoints、counters），并能追到“读取点/生效点”。

### 判定 checklist（用于“是否应该独立成模块”）

满足 ≥3 条建议独立成模块：

- 有独立的核心对象/状态机（结构体/枚举/标志位），且跨文件生命周期清晰
- 有独立的入口点（syscall/fault/hook/kthread/workqueue）
- 有独立且可复用的慢路径/异常路径集（回退/重试/超时/资源不足）
- 有独立的调优面与指标面（sysctl/debugfs/tracepoints 等）
- 与其它主题强耦合但抽象层不同（例如“页表机制” vs “缺页策略”）

---

## 13 个模块地图（【01】..【13】）

> 统一写作模板（每个模块必须包含同样字段）：
>
> - **范围/边界**
> - **依赖关系**
> - **典型入口点（entrypoints）**
> - **关键数据结构（种子清单）**
> - **主路径 call route（种子）**
> - **慢路径/异常路径（种子）**
> - **关键文件（必读 2–6 个）**
> - **调优参数/指标面（种子）**
> - **分析工具箱（该模块常用 5–8 个工具/命令）**
> - **最小源码导航命令（可直接复制）**

### 【01】进程地址空间与 VMA 管理（mmap 家族）

- **范围/边界**
  - 覆盖：`mmap/munmap/mprotect/mremap/brk/mlock/madvise`；VMA 插入/合并/查找；`mmap_lock` 语义
  - 不覆盖：page fault 细节（见【03】）、页表/TLB（见【02】）、memcg 计费（见【11】）
- **依赖关系**：无（建议作为 mm 系列入口）
- **典型入口点（entrypoints）**
  - syscall：`mm/mmap.c: SYSCALL_DEFINE6(mmap_pgoff)`、`SYSCALL_DEFINE2(munmap)`
  - syscall：`mm/mprotect.c: SYSCALL_DEFINE3(mprotect)`、`SYSCALL_DEFINE4(pkey_mprotect)`
  - 管理入口：`mm/mmap.c: do_mmap()`、`do_munmap()`、`mprotect_fixup()`、`do_mremap()`
- **关键数据结构（种子清单）**
  - `include/linux/mm_types.h: struct mm_struct, struct vm_area_struct`
  - `mm_struct.mm_rb`（VMA RB-tree；v5.15 仍为 rb-tree）
  - `struct vm_operations_struct`（与 file-backed fault 连接点）
- **主路径 call route（种子）**
  1. `mm/mmap.c: SYSCALL_DEFINE6(mmap_pgoff)`
  2. `mm/mmap.c: ksys_mmap_pgoff()`
  3. `mm/mmap.c: vm_mmap_pgoff()`
  4. `mm/mmap.c: do_mmap()`
  5. `mm/mmap.c: mmap_region()`
  6. `mm/mmap.c: vma_merge()` / `vma_link()` / `vma_rb_insert()`
- **慢路径/异常路径（种子）**
  - `-ENOMEM` / overcommit 拒绝：`mm/mmap.c` 调用 `security_vm_enough_memory_mm()`（落点在 `mm/util.c: __vm_enough_memory()`）
  - `mprotect` 触发拆分/合并：`mm/mprotect.c: mprotect_fixup()`
  - `munmap`/`madvise(DONTNEED)` 触发 unmap + TLB flush：与【02】相交
- **关键文件（必读 2–6 个）**
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/mmap.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/mmap_lock.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/mprotect.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/mremap.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/include/linux/mm_types.h`
- **调优参数/指标面（种子）**
  - overcommit 相关 sysctl：在【11】统一讲，但这里要指出触发点在 `mmap` 路径
  - 观测：`/proc/<pid>/maps`、`/proc/<pid>/smaps`（用于验证 VMA 形态）
- **分析工具箱**
  - 用户态：`pmap`/解析 `/proc/<pid>/smaps`（验证 VMA）
  - ftrace function_graph（看 `do_mmap/mmap_region` 的路线）
  - perf（`mmap` 高频/锁竞争：`mmap_lock`）
  - lockdep（排查 `mmap_lock` 锁序）
- **最小源码导航命令**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n "SYSCALL_DEFINE6\\(mmap_pgoff" $K/mm/mmap.c`
  - `rg -n "SYSCALL_DEFINE2\\(munmap" $K/mm/mmap.c`
  - `rg -n "\\bksys_mmap_pgoff\\b|\\bdo_mmap\\b|\\bmmap_region\\b" $K/mm/mmap.c`
  - `rg -n "\\bmmap_lock\\b" $K/mm/mmap_lock.c $K/mm/mmap.c`

### 【02】页表/映射与 unmap/TLB（含 arm64 glue）

- **范围/边界**
  - 覆盖：页表 walk/拆表；unmap/zap；TLB flush；`mmu_gather`；arm64 相关 flush/fault glue
  - 不覆盖：缺页策略与 page cache（见【03】【04】）
- **依赖关系**：建议先读【01】理解 VMA 与 `mmap_lock`
- **典型入口点（entrypoints）**
  - unmap：`mm/memory.c: unmap_vmas()`
  - TLB gather：`mm/mmu_gather.c: tlb_finish_mmu()`
  - arm64 fault glue（入口）：`arch/arm64/mm/fault.c: do_mem_abort()`
- **关键数据结构（种子清单）**
  - `struct mmu_gather`（TLB batch）
  - `struct vm_area_struct`（unmap 的范围来源）
  - arm64 页表/上下文结构（从 `arch/arm64/mm/mmu.c` 追）
- **主路径 call route（种子）**
  - unmap 路线（示例：`munmap`/`madvise(DONTNEED)`）：
    1. `mm/mmap.c: do_munmap()`
    2. `mm/madvise.c`/`mm/mmap.c`：触发 zap
    3. `mm/memory.c: unmap_vmas()`
    4. `mm/memory.c: zap_page_range()`（或同类 zap 路线）
    5. `mm/mmu_gather.c: tlb_finish_mmu()`
    6. `arch/arm64/mm/flush.c`（最终 flush 落点）
- **慢路径/异常路径（种子）**
  - 大范围 unmap 触发批量 TLB flush；观察：TLB flush 频率/开销
  - 页表拆分/锁：`split_page_table_lock`（文档见 `Documentation/vm/split_page_table_lock.rst`）
- **关键文件（必读 2–6 个）**
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/mmu_gather.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/memory.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/pagewalk.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/arch/arm64/mm/fault.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/arch/arm64/mm/flush.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/arch/arm64/mm/mmu.c`
- **调优参数/指标面（种子）**
  - debug：`mm/debug_vm_pgtable.c`、`arch/arm64/mm/ptdump*.c`
  - 观测：页表相关统计通常需要 tracepoints/perf（按模块文章补全）
- **分析工具箱**
  - perf（TLB miss / page walk 热点）
  - ftrace（跟踪 `unmap_vmas/tlb_finish_mmu`）
  - ptdump/debug_vm_pgtable（验证页表一致性与映射）
  - crash/gdb（dump 页表/地址转换状态）
- **最小源码导航命令**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n "\\bunmap_vmas\\b" $K/mm/memory.c`
  - `rg -n "\\btlb_finish_mmu\\b" $K/mm/mmu_gather.c`
  - `rg -n "\\bzap_page_range\\b" $K/mm/memory.c $K/mm/madvise.c`
  - `rg -n "\\bdo_mem_abort\\b" $K/arch/arm64/mm/fault.c`

### 【03】缺页异常（page fault）主路径（匿名/文件）

- **范围/边界**
  - 覆盖：`handle_mm_fault()` 主干；匿名页/文件页 fault；COW/WP；swap-in
  - 不覆盖：page cache 的整体算法（见【04】）、reclaim（见【06】）
- **依赖关系**：建议先读【01】【02】
- **典型入口点（entrypoints）**
  - arm64 fault 入口：`arch/arm64/mm/fault.c: do_mem_abort()`
  - 核心入口：`mm/memory.c: handle_mm_fault()`
- **关键数据结构（种子清单）**
  - `struct vm_fault`（fault 上下文）
  - `struct vm_area_struct`（决定 fault 策略/权限）
  - 页表项相关（与【02】交界）
- **主路径 call route（种子）**
  1. `arch/arm64/mm/fault.c: do_mem_abort()`
  2. `arch/arm64/mm/fault.c: handle_mm_fault(...)`（调用点）
  3. `mm/memory.c: handle_mm_fault()`
  4. `mm/memory.c: do_anonymous_page()`（匿名首次缺页示例）
  5. `mm/memory.c: do_wp_page()`（写保护/COW）
  6. `mm/memory.c: do_fault()`（file-backed fault 入口）
  7. `mm/memory.c: do_swap_page()`（swap-in 分支）
- **慢路径/异常路径（种子）**
  - major fault（IO）路径：由 `do_fault` 进入 filemap/readpage
  - OOM/回收介入：fault 路径里触发 direct reclaim（与【06】交界）
  - 权限错误：SIGSEGV（arm64 `do_mem_abort` 处理）
- **关键文件（必读 2–6 个）**
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/memory.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/arch/arm64/mm/fault.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/rmap.c`（反向映射常与 fault/reclaim 交织）
- **调优参数/指标面（种子）**
  - 观测：`/proc/vmstat`（pgfault/pgmajfault 等字段，文章中需映射到更新位置）
  - tracepoints：关注 `kmem/*`、`exceptions`/`fault` 相关事件（按实际系统补全）
- **分析工具箱**
  - perf（page fault 热点：`handle_mm_fault` 栈）
  - ftrace function_graph（验证 fault 分支路线：anon vs file vs swap）
  - eBPF/bpftrace（统计 fault 延迟/错误码/地址分布）
  - KASAN/KCSAN（UAF/竞态导致的奇怪 fault）
- **最小源码导航命令**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n "\\bhandle_mm_fault\\b" $K/mm/memory.c $K/arch/arm64/mm/fault.c`
  - `rg -n "\\bdo_anonymous_page\\b|\\bdo_wp_page\\b|\\bdo_fault\\b|\\bdo_swap_page\\b" $K/mm/memory.c`
  - `rg -n "\\bdo_mem_abort\\b" $K/arch/arm64/mm/fault.c`

### 【04】page cache & file-backed 内存（filemap/readahead/writeback）

- **范围/边界**
  - 覆盖：page cache 生命周期；readahead；writeback（mm 侧核心逻辑）
  - 不覆盖：具体文件系统实现与 block driver（只追到交界点）
- **依赖关系**：建议先读【03】
- **典型入口点（entrypoints）**
  - file-backed fault 进入点：`mm/memory.c: do_fault()` → `mm/filemap.c` 路线
  - readahead：`mm/readahead.c: do_page_cache_ra()`
  - writeback 调节：`mm/page-writeback.c: balance_dirty_pages()`
- **关键数据结构（种子清单）**
  - `struct address_space`（映射与 page cache 的宿主）
  - `struct folio`/`struct page`（v5.15 处于 page→folio 过渡期，文章需说明）
  - `struct writeback_control`、`struct bdi_writeback`
- **主路径 call route（种子）**
  - file fault → page cache（概念路线，文章中要补充具体函数节点）：
    1. `mm/memory.c: do_fault()`
    2. `mm/filemap.c: filemap_fault()`（或其调用链）
    3. `mm/readahead.c: do_page_cache_ra()`（可能触发）
    4. `mm/page-writeback.c: balance_dirty_pages()`（脏页回写调节）
- **慢路径/异常路径（种子）**
  - writeback 拥塞导致的抖动：balance_dirty_pages 频繁 sleep
  - truncate 与并发 page cache 失效：`mm/truncate.c`
- **关键文件（必读 2–6 个）**
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/filemap.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/readahead.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/page-writeback.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/truncate.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/fadvise.c`
- **调优参数/指标面（种子）**
  - 指标：`/proc/meminfo`、`/proc/vmstat`（dirty/writeback 相关字段）
  - tracepoints：`writeback/*`、`filemap/*`（按系统补全）
- **分析工具箱**
  - perf（IO 相关堆栈：fault→readpage/writeback）
  - ftrace（定位 writeback 回路与延迟点）
  - bpftrace（统计某 file/inode 的 page cache 行为）
  - iostat/bcc tools（与 block 层联动时辅助定位）
- **最小源码导航命令**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n "\\bfilemap_fault\\b" $K/mm/filemap.c`
  - `rg -n "\\bdo_page_cache_ra\\b|\\bpage_cache_ra_unbounded\\b" $K/mm/readahead.c`
  - `rg -n "\\bbalance_dirty_pages\\b" $K/mm/page-writeback.c`

### 【05】物理页分配器（memblock → buddy/zones/percpu pages）

- **范围/边界**
  - 覆盖：boot memblock；buddy allocator；zones；per-cpu pageset；分配/释放慢路径
  - 不覆盖：slab（见【10】）
- **依赖关系**：建议先读【01】或直接从这里作为“物理内存视角”入口
- **典型入口点（entrypoints）**
  - 分配：`mm/page_alloc.c: __alloc_pages()`
  - 释放：`mm/page_alloc.c: free_unref_page()`
  - 早期：`mm/memblock.c`（arch 早期内存布局与保留）
- **关键数据结构（种子清单）**
  - `struct page`、`struct zone`、`struct pglist_data`
  - `struct free_area`（buddy freelist）
  - `per_cpu_pages`（PCP）
- **主路径 call route（种子）**
  1. `mm/page_alloc.c: __alloc_pages()`
  2. `mm/page_alloc.c: get_page_from_freelist()`
  3. `mm/page_alloc.c: alloc_pages_slowpath()`（慢路径入口）
  4. `mm/page_alloc.c: free_unref_page()`
- **慢路径/异常路径（种子）**
  - 分配失败：水位线不足/碎片化 → direct reclaim（与【06】交界）/compaction（与【08】交界）
  - 高阶页失败：重点解释“order”与碎片化
- **关键文件（必读 2–6 个）**
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/memblock.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/page_alloc.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/mm_init.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/mmzone.c`
- **调优参数/指标面（种子）**
  - 指标：`/proc/zoneinfo`、`/proc/pagetypeinfo`、`/proc/vmstat`
  - tracepoints：`kmem:mm_page_alloc`/`mm_page_free` 类（按系统补全）
- **分析工具箱**
  - `vmstat 1`、`/proc/zoneinfo`、`/proc/pagetypeinfo`
  - perf（分配热点/失败路径）
  - ftrace（跟踪 `__alloc_pages` → slowpath 的分支）
  - page_owner/page_ext（定位“是谁分配了这页”）
- **最小源码导航命令**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n "\\b__alloc_pages\\b|\\bget_page_from_freelist\\b|\\balloc_pages_slowpath\\b" $K/mm/page_alloc.c`
  - `rg -n "\\bfree_unref_page\\b" $K/mm/page_alloc.c`
  - `rg -n "\\bmemblock\\b" $K/mm/memblock.c`

### 【06】内存回收（reclaim / LRU / vmscan / workingset）

- **范围/边界**
  - 覆盖：direct reclaim + kswapd；LRU；shrinkers；workingset/refault
  - 不覆盖：swap 的实现细节（见【07】）
- **依赖关系**：强依赖【05】（水位线/分配失败触发回收）；与【04】【07】【08】【11】交界多
- **典型入口点（entrypoints）**
  - direct reclaim：`mm/vmscan.c: try_to_free_pages()`
  - 后台线程：`kswapd`（`mm/vmscan.c` 内）
  - LRU 核心：`mm/vmscan.c: shrink_lruvec()`
- **关键数据结构（种子清单）**
  - `struct lruvec`、`struct scan_control`
  - `struct reclaim_state`
  - `struct folio`/`struct page`（与【04】联动）
- **主路径 call route（种子）**
  1. `mm/vmscan.c: try_to_free_pages()`
  2. `mm/vmscan.c: do_try_to_free_pages()`
  3. `mm/vmscan.c: shrink_node()`
  4. `mm/vmscan.c: shrink_lruvec()`
  5. `mm/vmscan.c: shrink_inactive_list()` / `shrink_active_list()`（文章中补全）
- **慢路径/异常路径（种子）**
  - 回收遇到脏页/写回拥塞：kswapd vs direct reclaim 行为差异
  - shrinker 回收（inode/dcache）导致跨子系统排查
- **关键文件（必读 2–6 个）**
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/vmscan.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/workingset.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/list_lru.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/rmap.c`
- **调优参数/指标面（种子）**
  - 指标：`/proc/vmstat`、`/proc/meminfo`、PSI `/proc/pressure/memory`
  - sysctl：`vm.swappiness`（与【07】也相关）、watermark 相关项（文章中需映射源码）
  - tracepoints：`vmscan/*`、`workingset/*`（按系统补全）
- **分析工具箱**
  - `vmstat 1`、`sar -B`、PSI（确认是否处于回收压力）
  - perf（回收热点：`shrink_*`）
  - ftrace（抓取 direct reclaim/kswapd 的关键函数链）
  - bpftrace（按进程/按 memcg 统计回收触发与耗时）
- **最小源码导航命令**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n "\\btry_to_free_pages\\b|\\bshrink_node\\b|\\bshrink_lruvec\\b" $K/mm/vmscan.c`
  - `rg -n "\\bkswapd\\b|\\bwakeup_kswapd\\b" $K/mm/vmscan.c`
  - `rg -n "\\bworkingset\\b|\\brefault\\b" $K/mm/workingset.c`

### 【07】swap 体系（swap cache / swapfile / zswap 等）

- **范围/边界**
  - 覆盖：swap entry/swap cache/swapfile；swap-in/out；zswap/zsmalloc/z3fold；frontswap/cleancache
  - 不覆盖：reclaim 主逻辑（见【06】）
- **依赖关系**：建议先读【06】再看 swap（因为 swap 是回收策略的重要分支）
- **典型入口点（entrypoints）**
  - fault swap-in：`mm/memory.c: do_swap_page()`
  - swap cache：`mm/swap_state.c: add_to_swap()`、`lookup_swap_cache()`
  - swapfile：`mm/swapfile.c`（swapon/swapoff）
  - zswap：`mm/zswap.c`
- **关键数据结构（种子清单）**
  - `swp_entry_t`（swap entry）
  - swap cache 页（page/folio + 交换映射）
  - zswap pool/object（按实现细化）
- **主路径 call route（种子）**
  1. `mm/memory.c: do_swap_page()`
  2. `mm/swap_state.c: lookup_swap_cache()`
  3. `mm/swap_state.c: add_to_swap()`
  4. `mm/swapfile.c`（查找 swap device/slot）
- **慢路径/异常路径（种子）**
  - swap IO 变慢导致 major fault 抖动
  - zswap 命中/回写到 swap 的分支（内存压力下行为差异）
- **关键文件（必读 2–6 个）**
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/swap.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/swap_state.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/swapfile.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/zswap.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/zsmalloc.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/z3fold.c`
- **调优参数/指标面（种子）**
  - 指标：`/proc/swaps`、`/proc/vmstat`（pswpin/pswpout 等）
  - sysctl：`vm.swappiness`；zswap 参数（按源码枚举）
- **分析工具箱**
  - `vmstat 1`（观察 swap in/out）
  - perf（swap-in 堆栈：fault→swap→IO）
  - bpftrace（统计 swap entry 热点/延迟）
  - iostat（确认是否是 IO 瓶颈）
- **最小源码导航命令**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n "\\bdo_swap_page\\b" $K/mm/memory.c`
  - `rg -n "\\badd_to_swap\\b|\\blookup_swap_cache\\b" $K/mm/swap_state.c`
  - `rg -n "\\bzswap\\b" $K/mm/zswap.c`

### 【08】迁移/隔离/碎片化治理（migration + compaction + CMA）

- **范围/边界**
  - 覆盖：页迁移；内存压缩（compaction）；page isolation；CMA 连续内存；kcompactd
  - 不覆盖：THP/hugetlb 语义（见【09】）
- **依赖关系**：依赖【05】（order/zone/buddy）与【06】（回收与迁移协作）
- **典型入口点（entrypoints）**
  - 迁移核心：`mm/migrate.c: migrate_pages()`
  - 压缩核心：`mm/compaction.c: compact_zone()`
  - CMA：`mm/cma.c: cma_alloc()`
- **关键数据结构（种子清单）**
  - `struct compact_control`、`struct capture_control`
  - `struct migrate_control`（按实现补全）
  - pageblock / migratetype（碎片化与隔离）
- **主路径 call route（种子）**
  1. `mm/compaction.c: compact_zone()`
  2. `mm/migrate.c: migrate_pages()`
  3. `mm/page_alloc.c`（与 buddy 交界，文章中补全）
- **慢路径/异常路径（种子）**
  - `migrate_pages()` 返回 `-ENOMEM` 或迁移失败的原因分类
  - “遇到不可迁移页导致 compaction 低效”的证据链
- **关键文件（必读 2–6 个）**
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/migrate.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/compaction.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/page_isolation.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/cma.c`
- **调优参数/指标面（种子）**
  - 指标：`/proc/pagetypeinfo`（迁移类型与碎片化）
  - tracepoints：`compaction/*`（按系统补全）
- **分析工具箱**
  - `/proc/pagetypeinfo` + 解释 “order vs migratetype”
  - perf（compaction 热点）
  - ftrace（`compact_zone`/`migrate_pages` 路线）
  - bpftrace（统计 compaction 触发原因与耗时）
- **最小源码导航命令**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n "\\bmigrate_pages\\b" $K/mm/migrate.c`
  - `rg -n "\\bcompact_zone\\b" $K/mm/compaction.c`
  - `rg -n "\\bcma_alloc\\b" $K/mm/cma.c`

### 【09】Huge pages（THP + hugetlb）

- **范围/边界**
  - 覆盖：THP（collapse/split）；khugepaged；hugetlb（预留、fault、unmap）
  - 不覆盖：基础 compaction/migration 机制（见【08】，这里只追交界点）
- **依赖关系**：建议先读【03】【05】【08】
- **典型入口点（entrypoints）**
  - THP：`mm/huge_memory.c`
  - khugepaged：`mm/khugepaged.c`
  - hugetlb fault：`mm/hugetlb.c: hugetlb_fault()`
- **关键数据结构（种子清单）**
  - THP PMD 级别结构/标志位（结合页表章节）
  - hugetlb hstate / hugepage pool
- **主路径 call route（种子）**
  - hugetlb fault：
    1. `mm/hugetlb.c: hugetlb_fault()`
    2. 分配/预留相关（文章中补全具体函数）
  - THP collapse：
    1. `mm/khugepaged.c`（kthread 扫描）
    2. `mm/huge_memory.c`（collapse/split 落点）
- **慢路径/异常路径（种子）**
  - THP split 导致延迟尖刺（触发条件与栈）
  - hugetlb 预留不足/overcommit 的错误路径
- **关键文件（必读 2–6 个）**
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/huge_memory.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/khugepaged.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/hugetlb.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/hugetlb_cgroup.c`
- **调优参数/指标面（种子）**
  - sysfs：hugetlb pool 参数（在 `hugetlb.c` 中注册）
  - sysctl：THP enable/defrag 等（按源码枚举并映射生效点）
- **分析工具箱**
  - perf（THP split/collapse 热点）
  - ftrace（`khugepaged` 路线）
  - bpftrace（统计 hugetlb fault/THP split 次数与延迟）
  - /proc/vmstat（THP 相关字段，按源码映射）
- **最小源码导航命令**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n "\\bhugetlb_fault\\b" $K/mm/hugetlb.c`
  - `rg -n "\\bkhugepaged\\b" $K/mm/khugepaged.c`
  - `rg -n "\\btransparent hugepage\\b|\\bTHP\\b" $K/mm/huge_memory.c`

### 【10】内核动态内存分配器（slab 家族：SLUB/SLAB/SLOB）

- **范围/边界**
  - 覆盖：`kmalloc/kmem_cache_alloc` 路线；对象缓存；调试（poison/redzone/usercopy 等）
  - 不覆盖：buddy allocator（见【05】）
- **依赖关系**：依赖【05】作为底层页提供者，但写作可相对独立
- **典型入口点（entrypoints）**
  - 分配 API：`mm/slub.c: kmem_cache_alloc()`（或 `mm/slab.c`/`mm/slob.c`）
  - 关键 fastpath：`mm/slub.c: ___slab_alloc()`
- **关键数据结构（种子清单）**
  - `struct kmem_cache`（核心）
  - `struct slab` / freelist（按实现：SLUB/SLAB/SLOB 差异）
- **主路径 call route（种子）**
  1. `mm/slub.c: kmem_cache_alloc()`
  2. `mm/slub.c: ___slab_alloc()`
  3. slowpath：new slab/page（文章中补全）
- **慢路径/异常路径（种子）**
  - 内存碎片/对象耗尽 → 走 slowpath/new slab
  - usercopy 检测失败/poison 检测（debug 配置开启时）
- **关键文件（必读 2–6 个）**
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/slub.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/slab_common.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/slab.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/slob.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/usercopy.c`
- **调优参数/指标面（种子）**
  - 指标：`/proc/slabinfo`、`slabtop`
  - boot params：`slub_debug=`（按源码枚举解析与生效点）
- **分析工具箱**
  - `slabtop`、`/proc/slabinfo`
  - KASAN/KFENCE/kmemleak（对象生命周期问题）
  - ftrace/perf（分配热点与锁竞争）
  - crash（dump kmem_cache/slab freelist）
- **最小源码导航命令**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n "\\bkmem_cache_alloc\\b|\\b___slab_alloc\\b" $K/mm/slub.c`
  - `rg -n "\\bslub_debug\\b" $K/mm/slub.c`
  - `rg -n "EXPORT_TRACEPOINT_SYMBOL\\(kmem_cache_alloc\\)" $K/mm/slab_common.c`

### 【11】资源控制与压力面（memcg / overcommit / OOM）

- **范围/边界**
  - 覆盖：memcg 计费/回收联动；overcommit；OOM（global + memcg OOM）
  - 不覆盖：reclaim 细节本体（见【06】，这里只讲策略/控制面与交界点）
- **依赖关系**：建议先读【01】【05】【06】
- **典型入口点（entrypoints）**
  - memcg charge：`mm/memcontrol.c: __mem_cgroup_charge()` / `try_charge_memcg()`
  - overcommit 判断：`mm/util.c: __vm_enough_memory()`（在 `mmap`/shmem/swapfile 等路径被调用）
  - OOM：`mm/oom_kill.c: out_of_memory()` → `oom_kill_process()`
- **关键数据结构（种子清单）**
  - `struct mem_cgroup`、`struct page_counter`
  - `struct oom_control`
  - 计费关联（page/folio 与 memcg 的关联字段）
- **主路径 call route（种子）**
  - overcommit（示例：mmap 路线里触发）：
    1. `mm/mmap.c`：调用 `security_vm_enough_memory_mm()`
    2. `mm/util.c: __vm_enough_memory()`
  - memcg charge：
    1. `mm/memcontrol.c: try_charge_memcg()`
    2. `mm/memcontrol.c: __mem_cgroup_charge()`
  - OOM：
    1. `mm/oom_kill.c: out_of_memory()`
    2. `mm/oom_kill.c: oom_kill_process()`
- **慢路径/异常路径（种子）**
  - memcg OOM 与 global OOM 的差异（选择策略、日志与处置）
  - charge 回退/重试、直接回收介入（与【06】交界）
- **关键文件（必读 2–6 个）**
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/memcontrol.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/page_counter.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/util.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/oom_kill.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/mmap.c`（overcommit 调用点）
- **调优参数/指标面（种子）**
  - sysctl：`vm.overcommit_memory`/`vm.overcommit_ratio`（按源码枚举与映射）
  - cgroup v2：memory.max/memory.high/memory.low 等（文章中需映射到 charge/reclaim/oom 行为）
  - 指标：PSI `/proc/pressure/memory`、OOM 日志/trace
- **分析工具箱**
  - `cat /proc/meminfo`、`cat /proc/vmstat`、PSI
  - cgroup 观测：读取 memory.current/pressure（按部署环境补全）
  - perf/ftrace（charge/oom 热点路径）
  - crash（OOM 后分析任务/内存状态）
- **最小源码导航命令**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n "__mem_cgroup_charge\\b|try_charge_memcg\\b" $K/mm/memcontrol.c`
  - `rg -n "\\bout_of_memory\\b|\\boom_kill_process\\b" $K/mm/oom_kill.c`
  - `rg -n "\\b__vm_enough_memory\\b" $K/mm/util.c`
  - `rg -n "security_vm_enough_memory_mm\\b" $K/mm/mmap.c $K/mm/shmem.c $K/mm/swapfile.c`

### 【12】NUMA 策略与内存策略（mempolicy/mbind/NUMA balancing/页迁移）

- **范围/边界**
  - 覆盖：NUMA node/zone 的“放置策略”；mempolicy syscall；自动 NUMA balancing（与调度/缺页交界）；move_pages/migrate_pages 迁移语义
  - 不覆盖：页迁移机制本体（见【08】），这里只讲“策略/接口/交界点”
- **依赖关系**：建议先读【01】【03】【05】【08】
- **典型入口点（entrypoints）**
  - syscall：`mm/mempolicy.c: SYSCALL_DEFINE6(mbind)`、`SYSCALL_DEFINE3(set_mempolicy)`、`SYSCALL_DEFINE4(migrate_pages)`、`SYSCALL_DEFINE6(move_pages)`
  - 关键策略点：`mm/mempolicy.c: policy_node()` / `mpol_shared_policy_lookup()`（文章中补齐主线函数）
  - 自动 NUMA balancing（交界点）：缺页路径触发并采样（文章中补齐与【03】的连接点）
- **关键数据结构（种子清单）**
  - `include/linux/mempolicy.h: struct mempolicy`
  - `struct task_struct` 上的 policy 关联（从 `mempolicy.c` 的访问点追）
  - nodemask 相关结构与辅助宏（便于读 syscall 参数解析）
- **主路径 call route（种子）**
  - `mbind()` 典型路线（概念种子，文章补齐）：
    1. `mm/mempolicy.c: SYSCALL_DEFINE6(mbind)`
    2. `mm/mempolicy.c`：解析 nodemask/flags
    3. `mm/mempolicy.c`：更新 VMA 级 policy（与【01】交界）
  - `set_mempolicy()` 典型路线：
    1. `mm/mempolicy.c: SYSCALL_DEFINE3(set_mempolicy)`
    2. `mm/mempolicy.c`：设置 task policy
- **慢路径/异常路径（种子）**
  - nodemask 不可达/内存不足：回退节点/返回错误码（需列清触发条件）
  - 迁移失败：`move_pages/migrate_pages` 返回值与 errno 语义（需要和【08】的 migrate 失败分类对齐）
- **关键文件（必读 2–6 个）**
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/mempolicy.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/numa.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/migrate.c`（只读交界点）
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/vmscan.c`（NUMA reclaim/回收交界）
- **调优参数/指标面（种子）**
  - sysctl：NUMA balancing 相关项（文章中需从 `kernel/sysctl.c` 的 `vm_table[]` 精确枚举并映射到读取点）
  - 指标：`/proc/vmstat`（NUMA 迁移/平衡相关计数，文章需映射更新点）
  - tracepoints：迁移/numa 相关 tracepoint（按源码枚举）
- **分析工具箱**
  - `numactl`（复现/验证 policy 生效）
  - perf（热点：NUMA fault/迁移栈）
  - ftrace（串起 `mempolicy.c` syscall → 选择节点 → 分配/迁移）
  - bpftrace（按进程统计 NUMA 迁移次数/延迟）
- **最小源码导航命令**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n "SYSCALL_DEFINE\\d*\\(mbind\\b|SYSCALL_DEFINE\\d*\\(set_mempolicy\\b|SYSCALL_DEFINE\\d*\\(migrate_pages\\b|SYSCALL_DEFINE\\d*\\(move_pages\\b" $K/mm/mempolicy.c`
  - `rg -n "\\bstruct mempolicy\\b" $K/include/linux/mempolicy.h`
  - `rg -n "\\bnuma\\b" $K/mm/numa.c -S`

### 【13】外部接口与高级特性（GUP/userfaultfd/mmu_notifier/HMM/DAMON/KSM…）

- **范围/边界**
  - 覆盖：GUP & pinning；userfaultfd；mmu_notifier；HMM；DAMON；KSM（这些是“插件层/对外接口层”）
  - 不覆盖：基础 VMA/页表/fault/reclaim 的完整解释（依赖前面模块）
- **依赖关系**：强依赖【01】【02】【03】【06】【11】（建议最后写）
- **典型入口点（entrypoints）**
  - GUP：`mm/gup.c: get_user_pages()` / pin_user_pages* 系列
  - userfaultfd：`mm/userfaultfd.c`
  - mmu_notifier：`mm/mmu_notifier.c`
  - HMM：`mm/hmm.c`
  - DAMON：`mm/damon/`
  - KSM：`mm/ksm.c`
- **关键数据结构（种子清单）**
  - GUP pin 相关标志与引用语义（`FOLL_PIN` 等）
  - userfaultfd 注册对象/事件队列
  - mmu notifier subscription
- **主路径 call route（种子）**
  - GUP（概念路线，文章补全具体分支）：
    1. `mm/gup.c: get_user_pages()`
    2. `mm/gup.c`（fast/slow path 分支）
  - userfaultfd（从缺页分支切入）：
    1. `mm/userfaultfd.c`（处理 wp/missing 等模式）
    2. 与【03】fault 分支交界（文章补全）
- **慢路径/异常路径（种子）**
  - GUP pin 导致的回收/迁移受阻（与【06】【08】【09】交界）
  - userfaultfd 用户态处理超时/卡死的风险点（排查路线）
- **关键文件（必读 2–6 个）**
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/gup.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/userfaultfd.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/mmu_notifier.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/hmm.c`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/damon/`
  - `/Volumes/CF/code/source-code/linux-5.15.200/mm/ksm.c`
- **调优参数/指标面（种子）**
  - debugfs/sysfs：按各特性模块注册点枚举（必须映射到源码 create/read/write 点）
  - tracepoints：按 feature 搜索 `TRACE_EVENT` 与 trace_* 调用点
- **分析工具箱**
  - bpftrace（对 GUP/userfaultfd/mmu_notifier 事件做统计聚合）
  - perf（pin/fault 路线热点）
  - ftrace（验证 fast/slow path 分支）
  - crash（追对象生命周期与引用计数）
- **最小源码导航命令**
  - `K=/Volumes/CF/code/source-code/linux-5.15.200`
  - `rg -n "\\bget_user_pages\\b|\\bpin_user_pages\\b" $K/mm/gup.c`
  - `rg -n "\\buserfaultfd\\b" $K/mm/userfaultfd.c`
  - `rg -n "\\bmmu_notifier\\b" $K/mm/mmu_notifier.c`
  - `rg -n "\\bhmm\\b" $K/mm/hmm.c`
  - `rg -n "\\bdamon\\b" $K/mm/damon -S`
  - `rg -n "\\bksm\\b" $K/mm/ksm.c`

---

## 为什么不合并 / 为什么不再细分（可复用论证模板）

### 为什么不合并（判断标准）

若满足任意一条，通常不要合并到同一篇：

- **抽象层不同**：机制层（页表/TLB）与策略层（fault/reclaim 分支）混写会导致走读不可控
- **核心对象不同**：以 `mm_struct/vma` 为中心的主题与以 `struct page/lruvec` 为中心的主题不宜合并
- **锁/上下文不同**：process context vs kthread vs IRQ/softirq，混写会让“并发与锁”章节失焦
- **工具/指标面不同**：例如 slab 的 /proc/slabinfo 与 vmscan 的 /proc/vmstat/vmscan tracepoints 是两套体系
- **常见问题入口不同**：缺页（SIGSEGV/major fault）与回收（PSI/kswapd 抖动）是不同排查起点

典型不建议合并的例子（可在文章中复用这段解释）：

- 【02 页表/unmap】 + 【03 缺页】：机制 vs 策略，且 arm64 flush 细节会淹没缺页主线
- 【06 reclaim】 + 【07 swap】：耦合但各自状态机完整，合并会让慢路径与参数/指标面爆炸
- 【05 allocator】 + 【10 slab】：抽象对象不同（页 vs 对象），调试与指标体系不同

### 为什么不再细分（当前先不拆到 14–16 的标准）

- a–g 章节要求完整：模块过细会导致大量重复的前置背景（VMA/页表/fault/reclaim 反复讲）
- mm 强交叉调用：过度细分会出现“写一篇必须同时打开 3–4 篇前置文”的循环依赖
- 工程收益下降：拆得越细，目录组织成本越高，且不利于形成稳定的“路径地图”

允许二次拆分的策略（当且仅当篇幅失控时）：

- 当某模块的“慢路径/工具箱/参数面”已无法在一篇写清（例如【12】），可拆成子篇：GUP / userfaultfd / mmu_notifier+HMM / DAMON+KSM

---

## 文章生成方式（给其它 agent 的操作指南）

### 路线 A：使用 skill 生成（推荐）

使用 `linux-kernel-study-docs` 生成骨架，然后按本 README 的模块字段补齐（重点补齐：call route + knobs 映射到源码生效点 + 工具箱最小命令）。

### 路线 B：使用脚手架脚本生成骨架（推荐给批量建档）

脚本位置：`/Users/gummum/.codex/skills/linux-kernel-study-docs/scripts/scaffold_kernel_note.py`

示例（生成【13】的空白骨架到本目录）：

```bash
python3 /Users/gummum/.codex/skills/linux-kernel-study-docs/scripts/scaffold_kernel_note.py \
  --title "mm-advanced-interfaces" \
  --module "mm/advanced (GUP, userfaultfd, mmu_notifier, HMM, DAMON, KSM)" \
  --index 13 \
  --kernel-tree /Volumes/CF/code/source-code/linux-5.15.200 \
  --out /Volumes/CF/code/gummum.github.io/_posts/kernel/mm/
```
