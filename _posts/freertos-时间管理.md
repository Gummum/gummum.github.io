---
title: "freertos时间管理"
categories:
  - freertos
---

## 透查本质

时间的管理可以说是时钟count的管理。一般操作系统都会管理两个时钟，一个高精度的，一个低精度的。

- 高精度时钟：一般用于高精度时间需求，如授时，时间戳等等。精度微秒纳秒级，一般由芯片自带的一个count维护。
- 低精度时钟：一般用于任务调度等等。精度ms级。

休眠在实时操作系统中一般都有两种。一种是自旋休眠，也就是不发生任务切换，另一种是主动挂起，直到超时时间到。

## 延时函数

在使用FreeRTOS的过程中经常会在一个任务中使用延时函数对该任务延时，当执行延时函数的时候就会进行任务切换，并且此任务就会进入阻塞态，直到延时完成，任务重新进入就绪态

> 相对延时是指每次延时都是从任务执行函数vTaskDelay()开始，延时指定的时间结束；
> 绝对延时是固定的频率运行，会自动补偿实际任务运行的时间。

### 相对延时函数

相对延时函数vTaskDelay()在文件task.c中定义，功能是使任务进入阻塞态，根据传入的参数延时多少个tick(系统节拍)，其函数原型如下：

```c
函数原型：void vTaskDelay(TickType_t xTicksToDelay)
传 入 值：xTicksToDelay 延时周期
     系统节拍周期为1000Hz，延时周期时基就是1ms；
     系统节拍周期为100Hz，延时周期时基就是10ms；

//源码
//宏INCLUDE_vTaskDelay须置1
void vTaskDelay(const TickType_t xTicksToDelay){
  /* xAlreadyYielded:已经调度的状态,初始赋值为0 */
  BaseType_t xAlreadyYielded = pdFALSE;
  /* 延时周期要大于0，否则就相当于直接调用portYIELD()进行任务切换 */
  if(xTicksToDelay > (TickType_t) 0U){
  configASSERT( uxSchedulerSuspended == 0 );
  /* 挂起调度器 */
  vTaskSuspendAll();
  {
    traceTASK_DELAY();
      /* 将要延时的任务添加到延时列表中 */
    prvAddCurrentTaskToDelayedList( xTicksToDelay, pdFALSE );
  }
    /* 恢复任务调度器 */
    xAlreadyYielded = xTaskResumeAll();
  }
  else{
  mtCOVERAGE_TEST_MARKER();
  }
  /* xAlreadyYielded 等于FALSE，表示在恢复调度器的时候，没有进行任务切换 */
  if(xAlreadyYielded == pdFALSE){
  /* 进行一次任务调度，内部就是触发PendSV异常 */
  portYIELD_WITHIN_API();
  }
  else{
  mtCOVERAGE_TEST_MARKER();
  }
}

```

prvAddCurrentTaskToDelayedList()函数用于将当前任务添加到等待列表中，文件task.c中定义，其源码如下：

```c
/* 添加任务到延时列表中
** 传入两个参数:
** xTicksToWait 延时周期
** xCanBlockIndefinitely 延时的确定状态 */
static void prvAddCurrentTaskToDelayedList(TickType_t xTicksToWait, 
                       const BaseType_t xCanBlockIndefinitely){
  /* 延时周期,表示下次唤醒的时间 */
  TickType_t xTimeToWake;
  /* 获取进入函数的时间点并保存在xConstTickCount中 */
  const TickType_t xConstTickCount = xTickCount;
  /* 把当前任务从就绪列表中移除 */
  if(uxListRemove( &( pxCurrentTCB->xStateListItem ) ) == ( UBaseType_t ) 0){
  /* 取消任务在uxTopReadyPriority中的就绪标记 */
  portRESET_READY_PRIORITY( pxCurrentTCB->uxPriority, uxTopReadyPriority );
  }
  else{
  mtCOVERAGE_TEST_MARKER();
  }
  /* 是否使用了任务挂起的功能 */
  #if ( INCLUDE_vTaskSuspend == 1 )
  {
  /* portMAX_DELAY=0XFFFFFFFF表示延时是一直持续的，即让任务一直阻塞 */
  if( ( xTicksToWait == portMAX_DELAY ) && ( xCanBlockIndefinitely != pdFALSE ) ){
    /* 把任务添加到，挂起列表中去*/
    vListInsertEnd( &xSuspendedTaskList, &( pxCurrentTCB->xStateListItem ) );
  }
  else{
    /* 计算任务唤醒的tick值 */
    xTimeToWake = xConstTickCount + xTicksToWait;
      /* 将计算到的任务唤醒时间点写入到任务列表中状态列表项的相应字段中 */
    listSET_LIST_ITEM_VALUE( &( pxCurrentTCB->xStateListItem ), xTimeToWake );
    /* 计算得到的任务唤醒时间点小于xConstTickCount，说明发生了溢出 */
    if( xTimeToWake < xConstTickCount){
    /* 若溢出，就把任务添加到延时溢出列表里 */
    vListInsert( pxOverflowDelayedTaskList, &( pxCurrentTCB->xStateListItem ) );
    }
    else{
    /* 若没有溢出，把任务添加到延时列表中，让内核进行处理 */
    vListInsert( pxDelayedTaskList, &( pxCurrentTCB->xStateListItem ) );
    /* 更新系统时间片，因为系统时间片永远保存最小的延时周期 */
    if( xTimeToWake < xNextTaskUnblockTime ){
      xNextTaskUnblockTime = xTimeToWake;
    }
    else{
      mtCOVERAGE_TEST_MARKER();
    }
    }
    }
  }
  #else /* INCLUDE_vTaskSuspend */
  {
  /* 计算下次唤醒的系统节拍值 */
  xTimeToWake = xConstTickCount + xTicksToWait;
  /* 赋值到任务控制块里 */
  listSET_LIST_ITEM_VALUE( &( pxCurrentTCB->xStateListItem ), xTimeToWake );
  if( xTimeToWake < xConstTickCount ){
    /* 溢出，添加到延时溢出列表中 */
    vListInsert( pxOverflowDelayedTaskList, &( pxCurrentTCB->xStateListItem ) );
  }
  else{
    /* 没有溢出，添加到延时列表中 */
    vListInsert( pxDelayedTaskList, &( pxCurrentTCB->xStateListItem ) );
      /* 更新时间片 */
    if( xTimeToWake < xNextTaskUnblockTime ){
      xNextTaskUnblockTime = xTimeToWake;
    }
    else{
    mtCOVERAGE_TEST_MARKER();
    }
  }
  /* Avoid compiler warning when INCLUDE_vTaskSuspend is not 1. */
  ( void ) xCanBlockIndefinitely;
  }
  #endif /* INCLUDE_vTaskSuspend */
}

```

### 绝对延时函数

绝对延时函数vTaskDelayUntil()在文件task.c中定义，功能是使任务进入阻塞态，直到一个绝对延时时间到达，其函数原型如下：

```c
函数原型：void vTaskDelayUntil(TickType_t *pxPreviousWakeTime，TickType_t xTimeIncrement)
传 入 值：pxPreviousWakeTime 记录任务上一次唤醒系统节拍值
     xTimeIncrement 相对于pxPreviousWakeTime，本次延时的节拍数


//源码
void vTaskDelayUntil(TickType_t * const pxPreviousWakeTime, 
           const TickType_t xTimeIncrement){
  /* 下次任务要唤醒的系统节拍值 */
  TickType_t xTimeToWake;
  /* xAlreadyYielded:表示是否已经进行了任务切换 */
  /* xShouldDelay:表示是否需要进行延时处理 */
  BaseType_t xAlreadyYielded, xShouldDelay = pdFALSE;
  /* 挂起调度器 */
  vTaskSuspendAll();
  {
  /* 获取系统节拍值 */
  const TickType_t xConstTickCount = xTickCount;
  /* 计算任务下次唤醒的系统节拍值 */
  xTimeToWake = *pxPreviousWakeTime + xTimeIncrement;
  /* pxPreviousWakeTime表示上一次任务的唤醒节拍值，若该值大于xConstTickCount表示：
     延时周期以及到达，或者xConstTickCount已经溢出了 */
  if( xConstTickCount < *pxPreviousWakeTime){
    /* 下一次要唤醒的系统节拍值小于上次要唤醒节拍值(即系统节拍值计数溢出) 
       下一次要唤醒的系统节拍值大于当前的系统节拍值(表示需要延时) */
    if((xTimeToWake < *pxPreviousWakeTime)&&(xTimeToWake > xConstTickCount)){
    /* 标记允许延时 */
    xShouldDelay = pdTRUE;
    }
    else{
    mtCOVERAGE_TEST_MARKER();
    }
  }
  else{
    /* 下一次要唤醒的系统节拍值小于上次要唤醒节拍值(即系统节拍值计数溢出)
       下一次要唤醒的系统节拍值大于当前的系统节拍值(表示需要延时) */
    if((xTimeToWake < *pxPreviousWakeTime)||(xTimeToWake > xConstTickCount)){
    /* 标记允许延时 */
    xShouldDelay = pdTRUE;
    }
    else{
    mtCOVERAGE_TEST_MARKER();
    }
  }
  /* 保存下次唤醒的节拍值，为下一次执行做准备 */
  *pxPreviousWakeTime = xTimeToWake;
  /* 判断是否需要延时 */
  if( xShouldDelay != pdFALSE ){
    traceTASK_DELAY_UNTIL( xTimeToWake );
      /* 添加任务到延时列表中去 */
    prvAddCurrentTaskToDelayedList( xTimeToWake - xConstTickCount, pdFALSE );
  }
  else{
    mtCOVERAGE_TEST_MARKER();
  }
  }
  /* 恢复任务调度器，若任务调度器内部进行了任务切换，返回true */
  xAlreadyYielded = xTaskResumeAll();
  /* 若调度器没有进行任务切换，那么要进行任务切换*/
  if( xAlreadyYielded == pdFALSE ){
  /* 进行PendSV异常触发 */
  portYIELD_WITHIN_API();
  }
  else{
  mtCOVERAGE_TEST_MARKER();
  }
}
```

### 调度器挂起和恢复

```c
//挂起
void vTaskSuspendAll(void){
  /* 调取记录值++ */
  ++uxSchedulerSuspended;
}

//恢复
BaseType_t xTaskResumeAll(void){
  TCB_t *pxTCB = NULL;
  BaseType_t xAlreadyYielded = pdFALSE;
  /* 进入临界段 */
  taskENTER_CRITICAL();
  {
  /* 调度器记录值减一 */
  --uxSchedulerSuspended;
  /* 如果调度器恢复了 */
  if( uxSchedulerSuspended == ( UBaseType_t ) pdFALSE ){
    /* 判断当前任务数量大于0 */
    if( uxCurrentNumberOfTasks > ( UBaseType_t ) 0U ){
    /* 从挂起的就绪列表中遍历 */
    while( listLIST_IS_EMPTY( &xPendingReadyList ) == pdFALSE ){
      /* 获取任务控制块 */
      pxTCB = ( TCB_t * ) listGET_OWNER_OF_HEAD_ENTRY( ( &xPendingReadyList ) );
      /* 移除挂起就绪列表，移除事件列表 */
      ( void ) uxListRemove( &( pxTCB->xEventListItem ) );
      ( void ) uxListRemove( &( pxTCB->xStateListItem ) );
      /* 添加到就绪列表中 */
      prvAddTaskToReadyList( pxTCB );
          /* 如果优先级大于当前任务优先级，则进行任务切换 */
      if( pxTCB->uxPriority >= pxCurrentTCB->uxPriority ){
      xYieldPending = pdTRUE;
      }
      else{
      mtCOVERAGE_TEST_MARKER();
      }
    }
    /* 获取到任务控制块不为空 */
    if( pxTCB != NULL ){
      /* 需要更新系统的时间片 */
      prvResetNextTaskUnblockTime();
    }
    /* 获取在调度器挂起时，systick挂起记录值 */
    {
          UBaseType_t uxPendedCounts = uxPendedTicks; /* Non-volatile copy. */
      /* 如果记录值大于0 */
      if( uxPendedCounts > ( UBaseType_t ) 0U ){
      do
      {
        /* 进行systick调度处理，遍历阻塞列表，如果需要任务切换，返回true */
        if( xTaskIncrementTick() != pdFALSE ){
          /* 标记任务需要切换 */
        xYieldPending = pdTRUE;
        }
        else{
        mtCOVERAGE_TEST_MARKER();
        }
        --uxPendedCounts;
        /* 一直遍历，直到uxPendedCounts = 0 */
      } while( uxPendedCounts > ( UBaseType_t ) 0U );
      /* 赋值为0 */
      uxPendedTicks = 0;
      }
      else{
      mtCOVERAGE_TEST_MARKER();
      }
    }
    /* 如果需要进行任务切换 */
    if( xYieldPending != pdFALSE ){
      /* 判断是否内核是抢占式 */
      #if( configUSE_PREEMPTION != 0 )
      {
      /* 标记已经调度的状态 */
      xAlreadyYielded = pdTRUE;
      }
      #endif
      /* 进行调度 */
      taskYIELD_IF_USING_PREEMPTION();
    }
    else{
      mtCOVERAGE_TEST_MARKER();
    }
    }
  }
  else{
    mtCOVERAGE_TEST_MARKER();
  }
  }
  /* 退出临界段 */
  taskEXIT_CRITICAL();
  /* 返回调度的状态值 */
  return xAlreadyYielded;
}


```

## FreeRTOS系统时钟节拍

不管是什么系统，运行都需要系统时钟节拍，xTickCount就是FreeRTOS的系统时钟节拍计数器。每个滴答定时器中断中xTickCount会加一，xTickCount的具体操作过程是在函数xTaskIncrementTick()中进行的

### SysTick初始化

系统节拍初始化函数vPortSetupTimerInterrupt()，在port.c文件中定义，其源码如下：

```c
void vPortSetupTimerInterrupt( void ){
  portNVIC_SYSTICK_LOAD_REG = ( configSYSTICK_CLOCK_HZ / configTICK_RATE_HZ ) - 1UL;
  portNVIC_SYSTICK_CTRL_REG = ( portNVIC_SYSTICK_CLK_BIT | portNVIC_SYSTICK_INT_BIT | portNVIC_SYSTICK_ENABLE_BIT );
}

```

### SysTick中断服务函数

系统节拍中断服务函数xPortSysTickHandler()，其源码如下：

```c
void xPortSysTickHandler( void ){
  /* 配置中断屏蔽寄存器,不让IRQ打断systick中断服务,即进入临街段  */
  vPortRaiseBASEPRI();
  {
  /* 操作系统调度接口，若调度器返回true，触发pendSV异常 */
  if( xTaskIncrementTick() != pdFALSE ){
    /* 触发pendSV */
    portNVIC_INT_CTRL_REG = portNVIC_PENDSVSET_BIT;
  }
  }
  /* 清除可屏蔽中断，即打开全部中断 */
  vPortClearBASEPRIFromISR();
}

```

### SysTick任务调度

系统节拍任务调度函数xTaskIncrementTick()

```c
BaseType_t xTaskIncrementTick( void ){
  TCB_t * pxTCB;
  TickType_t xItemValue;
  /* 返回值，表示是否进行上下文切换 */
  BaseType_t xSwitchRequired = pdFALSE;
  /* uxSchedulerSuspended表示任务调度器是否挂起，，pdFALSE表示没有被挂起 */
  if( uxSchedulerSuspended == ( UBaseType_t ) pdFALSE ){
  /* 时钟节拍计数器增加1 */
  const TickType_t xConstTickCount = xTickCount + 1;
  xTickCount = xConstTickCount;
  /* 判断tick是否溢出越界,为0说明发生了溢出 */
  if( xConstTickCount == ( TickType_t ) 0U ){
    /* 若溢出，要更新延时列表 */
      taskSWITCH_DELAYED_LISTS();
    }
    else{
  mtCOVERAGE_TEST_MARKER();
    }
    /* xNextTaskUnblockTime保存着下一个要解除阻塞的任务的时间点 */
    if( xConstTickCount >= xNextTaskUnblockTime ){
    /* 会一直遍历整个任务延时列表，主要目的是，找到时间片最短的任务，进行切换 */
    for( ;; ){
      /* 判断任务延时列表是否为空，即有没有任务在等待调度 */
      if( listLIST_IS_EMPTY( pxDelayedTaskList ) != pdFALSE ){
      /* 如果没有任务等待，把时间片赋值为最大值，不再调度 */
      xNextTaskUnblockTime = portMAX_DELAY; 
      break;
      }
       else{
      /* 若有任务等待，获取延时列表第一个列表项对应的任务控制块*/
      pxTCB = ( TCB_t * ) listGET_OWNER_OF_HEAD_ENTRY( pxDelayedTaskList );
      /* 获取上面任务控制块的状态列表项值 */
      xItemValue = listGET_LIST_ITEM_VALUE( &( pxTCB->xStateListItem ) );
      /* 再次判断这个任务的时间片是否到达 */
      if( xConstTickCount < xItemValue ){
        /* 若没有到达，把此任务的时间片更新为当前系统的时间片 */
        xNextTaskUnblockTime = xItemValue;
        /* 直接退出，不用调度 */
        break;
      }
      else{
        mtCOVERAGE_TEST_MARKER();
      }

      /* 任务延时时间到，把任务从延时列表中移除 */
      ( void ) uxListRemove( &( pxTCB->xStateListItem ) );
      /* 再把任务从事件列表中移除 */
      if( listLIST_ITEM_CONTAINER( &( pxTCB->xEventListItem ) ) != NULL ){
        ( void ) uxListRemove( &( pxTCB->xEventListItem ) );
      }
      else{
        mtCOVERAGE_TEST_MARKER();
      }
      /* 把任务添加到就绪列表中 */
      prvAddTaskToReadyList( pxTCB );
      /* 抢占式内核 */
      #if (  configUSE_PREEMPTION == 1 )
      {
        /* 判断解除阻塞的任务的优先级是否高于当前任务的优先级 */
        if( pxTCB->uxPriority >= pxCurrentTCB->uxPriority ){
        /* 如果是的话，就需要进行一次任务切换 */
        xSwitchRequired = pdTRUE;  
        }
        else{
        mtCOVERAGE_TEST_MARKER();
        }
      }
      #endif /* configUSE_PREEMPTION */
      }
    }
    }

    /* 若使能了时间片处理机制，还需要处理同优先级下任务之间的调度 */
    #if ( ( configUSE_PREEMPTION == 1 ) && ( configUSE_TIME_SLICING == 1 ) )
    {
    /* 获取就绪列表长度, 若有其他任务在就绪列表中，就开始调度*/
      if( listCURRENT_LIST_LENGTH( &( pxReadyTasksLists[ pxCurrentTCB->uxPriority ] ) ) > ( UBaseType_t ) 1 ){
      xSwitchRequired = pdTRUE;
    }
    else{
      mtCOVERAGE_TEST_MARKER();
    }
    }
    #endif /* ( ( configUSE_PREEMPTION == 1 ) && ( configUSE_TIME_SLICING == 1 ) ) */
  }
  else{ /* 任务调度器挂起 */
    /* 挂起的tick+1 */
  ++uxPendedTicks;
  }
  /* 如果是抢占模式，要开启调度 */
  #if ( configUSE_PREEMPTION == 1 )
  {
  if( xYieldPending != pdFALSE ){
    xSwitchRequired = pdTRUE;
  }
  else{
    mtCOVERAGE_TEST_MARKER();
  }
  }
  #endif /* configUSE_PREEMPTION */
  /* 返回调度器状态 */
  return xSwitchRequired;
}

```
