# 编译原理

[想初步了解编译原理？看这篇文章就够了 (zhihu.com)](https://www.zhihu.com/tardis/zm/art/362072187?source_id=1005 "想初步了解编译原理？看这篇文章就够了 (zhihu.com)")

[编译原理入门篇|一篇文章理解编译全过程 - fishers - 博客园 (cnblogs.com)](https://www.cnblogs.com/fisherss/p/13905395.html "编译原理入门篇|一篇文章理解编译全过程 - fishers - 博客园 (cnblogs.com)")

# 编译原理介绍

![image.png](../../home/bl/img/U1/image_20250226_211613_621.png)

![image.png](../../home/bl/img/U1/image_20250226_211618_739.png)

# 词法分析

词法分析（Lexical Analysis）是编译过程的第一个阶段。它的主要任务是将源代码（通常是文本格式）转换成一系列的记号（tokens），这些记号是语法分析器（parser）处理的基本单位。

作用：

- **源代码到记号**: 词法分析将源代码中的字符流转换为记号流。记号是源代码中的基本单位，如关键字、标识符、操作符和分隔符等。
- **去除无关信息**: 词法分析器还负责去除源代码中的空白字符和注释，这些对编译过程的后续阶段通常没有影响。

## 正则表达式

[learn-regex/translations/README-cn.md at master · ziishaned/learn-regex (github.com)](https://github.com/ziishaned/learn-regex/blob/master/translations/README-cn.md "learn-regex/translations/README-cn.md at master · ziishaned/learn-regex (github.com)")

## 有穷自动机

[https://zhuanlan.zhihu.com/p/30009083](https://zhuanlan.zhihu.com/p/30009083 "https://zhuanlan.zhihu.com/p/30009083")

[NFA到DFA的转化（保证能讲明白）\_nfa转dfa-CSDN博客](https://blog.csdn.net/weixin_43655282/article/details/108963761 "NFA到DFA的转化（保证能讲明白）_nfa转dfa-CSDN博客")

[有穷自动机](https://zhida.zhihu.com/search?q=有穷自动机\&zhida_source=entity\&is_preview=1 "有穷自动机")(*finite state automata*)是一个识别器，它对每个输入的字符做识别和判断，以确定其能到达的最终状态或状态集和路径，有穷自动机分为两类，即不确定的有穷自动机NFA和确定的有穷自动机DFA

### dfa

### nfa
