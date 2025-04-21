---
title: "freertos事件标记组"
categories:
  - freertos
---

## 透查本质

事件是软件解耦的一种重要手段。同时这是一种通知机制，类似发布订阅模式。

## 事件标志组简介

信号量只能实现任务与单个事件或任务间的同步。但是某些任务可能会需要与多个事件或任务进行同步，此时就可以使用事件标志组来解决。事件标志组能够实现某个任务与多个事件或任务间的同步

- 事件位：用来表明某个事件是否发生，通常用作事件标志
- 事件组：一组事件位组成一个事件组，事件组中的事件位通过编号来访问

事件标志组的数据类型为 *EventGroupHandle\_t*，事件标志组中的所有事件位都存储在一个无符号的 *EventBits\_t* 类型的变量中；该变量为16位数据类型时，事件标志组可以存储8个事件位；该变量为32位数据类型时，事件标志组可以存储24个事件位（高8位均有其他用途）

```c
/***************EventBits_t在event_groups.h中定义**********/
typedef TickType_t EventBits_t;
/***************TickType_t在portmacro.h中定义**************/
#if( configUSE_16_BIT_TICKS == 1 )
    typedef uint16_t TickType_t;//事件标志组可以存储8个事件位
    #define portMAX_DELAY ( TickType_t ) 0xffff
#else
    typedef uint32_t TickType_t;//事件标志组可以存储24个事件位
    #define portMAX_DELAY ( TickType_t ) 0xffffffffUL
    #define portTICK_TYPE_IS_ATOMIC 1
#endif

```

## 事件标志组API函数

### 创建事件标志组

```c
/********************动态创建事件标志组**********************************************/
EventGroupHandle_t xEventGroupCreate(void)
/********************静态创建事件标志组**********************************************/
EventGroupHandle_t xEventGroupCreateStatic(StaticEventGroup_t * pxEventGroupBuffer)
//参数：pxEventGroupBuffer指向一个StaticEventGroup_t类型的变量，用来保存事件标志组结构体
/***********************************************************************************/
返回值：创建成功返回事件标志组句柄；失败返回NULL

```

### 设置事件位

```c
/****************将指定的事件位清零，用在任务中***************************************/
EventBits_t xEventGroupClearBits(EventGroupHandle_t xEventGroup,//要操作的事件标志组句柄
                 const EventBits_t uxBitsToClear)//要清零的事件位
/****************将指定的事件位置1，用在任务中***************************************/
EventBits_t xEventGroupSetBits(EventGroupHandle_t xEventGroup,//要操作的事件标志组句柄
                 const EventBits_t uxBitsToSet)//要置1的事件位
返回值：将指定事件位清零之前的事件组值；将指定事件位置1后的事件组值
/****************将指定的事件位清零，用在中断服务函数中********************************/
BaseType_t xEventGroupClearBitsFromISR(EventGroupHandle_t xEventGroup,
                      const EventBits_t uxBitsToClear)//要清零的事件位               
/****************将指定的事件位置1，用在中断服务函数中********************************/
//#define configUSE_TRACE_FACILITY需要配置为1
BaseType_t xEventGroupSetBitsFromISR(EventGroupHandle_t xEventGroup, 
                   const EventBits_t uxBitsToSet,//要置1的事件位
              BaseType_t *pxHigherPriorityTaskWoken)//标记退出后是否切换任务
返回值：清零或置1成功返回pdPASS;清零或置1失败返回pdFALSE             

```

指定事件位清零函数xEventGroupClearBits的源码如下示：

```c
EventBits_t xEventGroupClearBits(EventGroupHandle_t xEventGroup,
                const EventBits_t uxBitsToClear){
  EventGroup_t *pxEventBits = ( EventGroup_t * ) xEventGroup;
  EventBits_t uxReturn;
  taskENTER_CRITICAL();//进入临界段
  {
    /* 获取当前事件标志位 */
    uxReturn = pxEventBits->uxEventBits;
    /* 清除要设置的事件标志位 */
    pxEventBits->uxEventBits &= ~uxBitsToClear;
  }
  taskEXIT_CRITICAL();//退出临界段
  return uxReturn;//返回事件标志组值
}

```

指定事件位置1函数xEventGroupSetBits的源码如下示：

```c
EventBits_t xEventGroupSetBits(EventGroupHandle_t xEventGroup,
                const EventBits_t uxBitsToSet){
  ListItem_t *pxListItem, *pxNext;
  ListItem_t const *pxListEnd;
  List_t *pxList;
  EventBits_t uxBitsToClear = 0, uxBitsWaitedFor, uxControlBits;
  EventGroup_t *pxEventBits = ( EventGroup_t * ) xEventGroup;
  BaseType_t xMatchFound = pdFALSE;
  /* 获取事件列表头 */
  pxList = &( pxEventBits->xTasksWaitingForBits );
  /* 获取列表尾节点 */
  pxListEnd = listGET_END_MARKER( pxList ); 
  vTaskSuspendAll();//挂起调度器
  {  
    pxListItem = listGET_HEAD_ENTRY( pxList );//获取头节点
    pxEventBits->uxEventBits |= uxBitsToSet;//设置事件标志位
    /* 循环遍历整个列表项，直到列表头节点等于尾节点（指针） */
    while(pxListItem != pxListEnd){      
      pxNext = listGET_NEXT(pxListItem);//获取下个列表项
      /* 获取当前列表项的值 */
      uxBitsWaitedFor = listGET_LIST_ITEM_VALUE(pxListItem);    
      xMatchFound = pdFALSE;//标记是否找到需要处理的节点
      /* 拆分 */
      uxControlBits = uxBitsWaitedFor & eventEVENT_BITS_CONTROL_BYTES;
      uxBitsWaitedFor &= ~eventEVENT_BITS_CONTROL_BYTES;
      if((uxControlBits & eventWAIT_FOR_ALL_BITS) == (EventBits_t)0){
        /* 或逻辑，等待位已经置位 */
        if((uxBitsWaitedFor & pxEventBits->uxEventBits) != (EventBits_t)0){      
          xMatchFound = pdTRUE;//找到了已经触发的节点
        }
        else{
          mtCOVERAGE_TEST_MARKER();
        }
      }
      /* 表示所有等待的位都已经触发 */
      else if((uxBitsWaitedFor&pxEventBits->uxEventBits) == uxBitsWaitedFor){    
        xMatchFound = pdTRUE;//找到触发的节点
      }
      else{
        /* Need all bits to be set, but not all the bits were set. */
      }

      if( xMatchFound != pdFALSE ){
        /* 判断是否需要清除 */
        if((uxControlBits & eventCLEAR_EVENTS_ON_EXIT_BIT)!=(EventBits_t)0){
          uxBitsToClear |= uxBitsWaitedFor;//做个标记
        }
        else{
          mtCOVERAGE_TEST_MARKER();
        }
        /* 把任务从事件列表中移除  */
        (void)xTaskRemoveFromUnorderedEventList(pxListItem,pxEventBits->uxEventBits|eventUNBLOCKED_DUE_TO_BIT_SET);
      }
      pxListItem = pxNext;//当前列表项指向下个，继续遍历
    }
    pxEventBits->uxEventBits &= ~uxBitsToClear;//清除设置后的标志位
  }  
  (void) xTaskResumeAll();//开启调度器
  return pxEventBits->uxEventBits;
}

```

#### 获取事件标志组值

```c
/****************获取当前事件标志组的值，用在任务中***********************************/
EventBits_t xEventGroupGetBits(EventGroupHandle_t xEventGroup)//要操作的事件标志组句柄
/****************获取当前事件标志组的值，用在中断服务函数中****************************/
EventBits_t xEventGroupGetBitsFromISR(EventGroupHandle_t xEventGroup)
返回值：当前事件标志组的值

```

用在任务中获取当前事件标志组的值函数是一个宏定义，如下示：

```c
EventBits_t xEventGroupGetBitsFromISR(EventGroupHandle_t xEventGroup){
  UBaseType_t uxSavedInterruptStatus;
  EventGroup_t *pxEventBits = ( EventGroup_t * ) xEventGroup;
  EventBits_t uxReturn;  
  /* 禁止中断,带返回值 */
  uxSavedInterruptStatus = portSET_INTERRUPT_MASK_FROM_ISR();
  {    
    uxReturn = pxEventBits->uxEventBits;//获取事件标志位
  }
  /* 恢复中断，在进入禁止之前的状态 */
  portCLEAR_INTERRUPT_MASK_FROM_ISR( uxSavedInterruptStatus );
  return uxReturn;
}

```

等待指定的事件位

```c
/****************等待指定的事件位***************************************************/
EventBits_t xEventGroupWaitBits(EventGroupHandle_t xEventGroup, //要等待的事件标志组
               const EventBits_t uxBitsToWaitFor, //要等待的事件位
                 const BaseType_t xClearOnExit, //退出是否要清除位
                const BaseType_t xWaitForAllBits, //与逻辑还是或逻辑
                     TickType_t xTicksToWait) //阻塞等待时间
参  数：xClearOnExit若为pdTURE，则表示设置的位在函数退出时会被清零；
    xWaitForAllBits若为pdTURE，则表示所有要设置的位都置1或阻塞时间到，函数才会返回
    若为pdFALSE,则表示只要要设置的某一位置1或阻塞时间到，函数就会返回
返回值：返回所等待的事件位置1后的事件标志组的值，或返回阻塞时间到


EventBits_t xEventGroupWaitBits( EventGroupHandle_t xEventGroup, 
                const EventBits_t uxBitsToWaitFor, 
                const BaseType_t xClearOnExit, 
                const BaseType_t xWaitForAllBits, 
                TickType_t xTicksToWait){
  EventGroup_t *pxEventBits = ( EventGroup_t * ) xEventGroup;
  EventBits_t uxReturn, uxControlBits = 0;
  BaseType_t xWaitConditionMet, xAlreadyYielded;
  BaseType_t xTimeoutOccurred = pdFALSE;  
  vTaskSuspendAll();//挂起调度器
  {
    /* 获取当前的事件标志位 */
    const EventBits_t uxCurrentEventBits = pxEventBits->uxEventBits;
    /* 检查是否触发 */
    xWaitConditionMet = prvTestWaitCondition(uxCurrentEventBits, uxBitsToWaitFor, xWaitForAllBits);
    if( xWaitConditionMet != pdFALSE ){      
      /* 已经触发 */
      uxReturn = uxCurrentEventBits;
      xTicksToWait = ( TickType_t ) 0;
      /* 清楚已经触发的标志 */
      if( xClearOnExit != pdFALSE ){
        pxEventBits->uxEventBits &= ~uxBitsToWaitFor;
      }
      else{
        mtCOVERAGE_TEST_MARKER();
      }
    }
    else if(xTicksToWait == (TickType_t) 0){
      /* 不需要超时，直接返回标志位. */
      uxReturn = uxCurrentEventBits;
    }
    else{
      /* 事件没有触发，并且需要超时*/
      if( xClearOnExit != pdFALSE ){
        uxControlBits |= eventCLEAR_EVENTS_ON_EXIT_BIT;
      }
      else{
        mtCOVERAGE_TEST_MARKER();
      }

      if( xWaitForAllBits != pdFALSE ){
        //uxControlBits = 0x05000000UL;
        uxControlBits |= eventWAIT_FOR_ALL_BITS;
      }
      else{
        mtCOVERAGE_TEST_MARKER();
      }

      /* 把任务添加到事件列表中  */
      vTaskPlaceOnUnorderedEventList(&( pxEventBits->xTasksWaitingForBits), ( uxBitsToWaitFor | uxControlBits ), xTicksToWait );
      uxReturn = 0;
      traceEVENT_GROUP_WAIT_BITS_BLOCK( xEventGroup, uxBitsToWaitFor );
    }
  }
  xAlreadyYielded = xTaskResumeAll();//恢复调度器  
  if(xTicksToWait != (TickType_t ) 0){//再次判断是否需要超时
    if( xAlreadyYielded == pdFALSE ){
      portYIELD_WITHIN_API();//进行上下文切换 ->pendSV
    }
    else{
      mtCOVERAGE_TEST_MARKER();
    }
    /* 任务已经恢复，则复位列表项中的值  复位为任务有优先级 */
    uxReturn = uxTaskResetEventItemValue();
    /* 是不是通过事件置位解除的任务 */
    if((uxReturn & eventUNBLOCKED_DUE_TO_BIT_SET) == (EventBits_t)0){    
      taskENTER_CRITICAL();//进入临界段
      {
        
        uxReturn = pxEventBits->uxEventBits;// 获取当前事件位
        /* 再此判断是否已经置位 */
        if( prvTestWaitCondition( uxReturn, uxBitsToWaitFor, xWaitForAllBits ) != pdFALSE ){
          /* 如果需要清除，清除触发后的标志位 */
          if( xClearOnExit != pdFALSE ){
            pxEventBits->uxEventBits &= ~uxBitsToWaitFor;
          }
          else{
            mtCOVERAGE_TEST_MARKER();
          }
        }
        else{
          mtCOVERAGE_TEST_MARKER();
        }
      }
      taskEXIT_CRITICAL();
      xTimeoutOccurred = pdFALSE;
    }
    else{
      /* The task unblocked because the bits were set. */
    }
    /* 返回当前事件标志位 */
    uxReturn &= ~eventEVENT_BITS_CONTROL_BYTES;
  }
  traceEVENT_GROUP_WAIT_BITS_END( xEventGroup, uxBitsToWaitFor, xTimeoutOccurred );
  return uxReturn;
}


```

### 等待指定的事件位

```c
/****************等待指定的事件位***************************************************/
EventBits_t xEventGroupWaitBits(EventGroupHandle_t xEventGroup, //要等待的事件标志组
               const EventBits_t uxBitsToWaitFor, //要等待的事件位
                 const BaseType_t xClearOnExit, //退出是否要清除位
                const BaseType_t xWaitForAllBits, //与逻辑还是或逻辑
                     TickType_t xTicksToWait) //阻塞等待时间
参  数：xClearOnExit若为pdTURE，则表示设置的位在函数退出时会被清零；
    xWaitForAllBits若为pdTURE，则表示所有要设置的位都置1或阻塞时间到，函数才会返回
    若为pdFALSE,则表示只要要设置的某一位置1或阻塞时间到，函数就会返回
返回值：返回所等待的事件位置1后的事件标志组的值，或返回阻塞时间到


EventBits_t xEventGroupWaitBits( EventGroupHandle_t xEventGroup, 
                const EventBits_t uxBitsToWaitFor, 
                const BaseType_t xClearOnExit, 
                const BaseType_t xWaitForAllBits, 
                TickType_t xTicksToWait){
  EventGroup_t *pxEventBits = ( EventGroup_t * ) xEventGroup;
  EventBits_t uxReturn, uxControlBits = 0;
  BaseType_t xWaitConditionMet, xAlreadyYielded;
  BaseType_t xTimeoutOccurred = pdFALSE;  
  vTaskSuspendAll();//挂起调度器
  {
    /* 获取当前的事件标志位 */
    const EventBits_t uxCurrentEventBits = pxEventBits->uxEventBits;
    /* 检查是否触发 */
    xWaitConditionMet = prvTestWaitCondition(uxCurrentEventBits, uxBitsToWaitFor, xWaitForAllBits);
    if( xWaitConditionMet != pdFALSE ){      
      /* 已经触发 */
      uxReturn = uxCurrentEventBits;
      xTicksToWait = ( TickType_t ) 0;
      /* 清楚已经触发的标志 */
      if( xClearOnExit != pdFALSE ){
        pxEventBits->uxEventBits &= ~uxBitsToWaitFor;
      }
      else{
        mtCOVERAGE_TEST_MARKER();
      }
    }
    else if(xTicksToWait == (TickType_t) 0){
      /* 不需要超时，直接返回标志位. */
      uxReturn = uxCurrentEventBits;
    }
    else{
      /* 事件没有触发，并且需要超时*/
      if( xClearOnExit != pdFALSE ){
        uxControlBits |= eventCLEAR_EVENTS_ON_EXIT_BIT;
      }
      else{
        mtCOVERAGE_TEST_MARKER();
      }

      if( xWaitForAllBits != pdFALSE ){
        //uxControlBits = 0x05000000UL;
        uxControlBits |= eventWAIT_FOR_ALL_BITS;
      }
      else{
        mtCOVERAGE_TEST_MARKER();
      }

      /* 把任务添加到事件列表中  */
      vTaskPlaceOnUnorderedEventList(&( pxEventBits->xTasksWaitingForBits), ( uxBitsToWaitFor | uxControlBits ), xTicksToWait );
      uxReturn = 0;
      traceEVENT_GROUP_WAIT_BITS_BLOCK( xEventGroup, uxBitsToWaitFor );
    }
  }
  xAlreadyYielded = xTaskResumeAll();//恢复调度器  
  if(xTicksToWait != (TickType_t ) 0){//再次判断是否需要超时
    if( xAlreadyYielded == pdFALSE ){
      portYIELD_WITHIN_API();//进行上下文切换 ->pendSV
    }
    else{
      mtCOVERAGE_TEST_MARKER();
    }
    /* 任务已经恢复，则复位列表项中的值  复位为任务有优先级 */
    uxReturn = uxTaskResetEventItemValue();
    /* 是不是通过事件置位解除的任务 */
    if((uxReturn & eventUNBLOCKED_DUE_TO_BIT_SET) == (EventBits_t)0){    
      taskENTER_CRITICAL();//进入临界段
      {
        
        uxReturn = pxEventBits->uxEventBits;// 获取当前事件位
        /* 再此判断是否已经置位 */
        if( prvTestWaitCondition( uxReturn, uxBitsToWaitFor, xWaitForAllBits ) != pdFALSE ){
          /* 如果需要清除，清除触发后的标志位 */
          if( xClearOnExit != pdFALSE ){
            pxEventBits->uxEventBits &= ~uxBitsToWaitFor;
          }
          else{
            mtCOVERAGE_TEST_MARKER();
          }
        }
        else{
          mtCOVERAGE_TEST_MARKER();
        }
      }
      taskEXIT_CRITICAL();
      xTimeoutOccurred = pdFALSE;
    }
    else{
      /* The task unblocked because the bits were set. */
    }
    /* 返回当前事件标志位 */
    uxReturn &= ~eventEVENT_BITS_CONTROL_BYTES;
  }
  traceEVENT_GROUP_WAIT_BITS_END( xEventGroup, uxBitsToWaitFor, xTimeoutOccurred );
  return uxReturn;
}

```