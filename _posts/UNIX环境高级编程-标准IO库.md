---
title: "标准I/O库"
categories:
  - UNIX环境高级编程
---

[目录](UNIX环境高级编程)

## 引言

## 流和FILE对象

函数原型：

```c
#include <wchar.h>
int fwide(FILE *stream, int mode);
```

参数 mode 含义：

- mode > 0: 尝试将流设为 宽字符方向（wide-oriented）
- mode < 0: 尝试将流设为 字节方向（byte‑oriented）
- mode == 0: 仅查询当前方向，不作更改

## 标准输入、标准输出和标准错误

## 缓冲

标准I/O提供了以下三种类型的缓冲：

- 全缓冲。在填满标准I/O缓冲区后才进行实际I/O操作。
- 行缓冲。在输入和输出中遇到换行符时，进行I/O操作。
  - 任何时候只要通过标准I/0库要求从(a)一个不带缓冲的流，或者(b)一个行缓冲的流(它从内核请求需要数据)得到输入数据，那么就会冲洗所有行缓冲输出流。在(b)中带了一个在括号中的说明,其理由是，所需的数据可能已在该缓冲区中，它并不要求一定从内核读数据。很明显，从一个不带缓冲的流中输入(即(a)项)需要从内核获得数据。

  想象一个典型场景：

  ```c
  printf("Enter your name: ");  // 用于提示用户，需要看到输出
  scanf("%s", name);            // 从 stdin 读取用户输入
  ```

  这里希望看到提示信息再读用户输入。机制上，如果 scanf 需从 stdin 向内核读数据，它会触发 stdout 的刷新。但如果 stdin 缓存已有输入，可能不会触发刷新，这通常符合预期。

- 无缓冲。直接进行I/O操作。(例如，标准错误流)

修改缓冲类型：

```c
void setbuf(FILE *fp, char *buf);
int setvbuf(FILE *fp, char *buf, int mode, size_t size);
```

刷新缓冲区：

```c
int fflush(FILE *stream);
```

## 打开流

```c
FILE *fopen(const char *pathname, const char *type);
FILE *freopen(const char *pathname, const char *type, FILE *stream);
FILE *fdopen(int fd, const char *type);
```

使用 `fdopen()` 与 socket 的结合

将 socket 文件描述符封装为 `FILE*` 流，可以让你使用标准 C 库的 I/O（如 `fgets`, `fprintf`, `fscanf` 等），这在处理基于文本行协议（如 HTTP、SMTP、FTP 等）时非常方便。

```c
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <string.h>
#include <sys/socket.h>
#include <netinet/in.h>

#define BUF_SIZE 1024

int main(void) {
    int sock = socket(AF_INET, SOCK_STREAM, 0);
    // ... connect 或 accept 该 socket ...

    // 建议对读写分别 dup，避免 bidirectional 混乱
    int sock_r = dup(sock);
    int sock_w = dup(sock);

    FILE *fpin  = fdopen(sock_r, "r");
    FILE *fpout = fdopen(sock_w, "w");
    if (!fpin || !fpout) {
        perror("fdopen");
        exit(EXIT_FAILURE);
    }

    setlinebuf(fpin);
    setlinebuf(fpout);

    // 示例：简单回声服务器
    char line[BUF_SIZE];
    while (fgets(line, sizeof(line), fpin) != NULL) {
        fprintf(fpout, "Echo: %s", line);
        // flush on newline because of line buffering
    }

    // 正确关闭流程
    fclose(fpin);
    fclose(fpout);
    close(sock);  // 原始 fd 仍需关闭

    return 0;
}

```

## 读和写流

```c
int getc(FILE *fp);
int fgetc(FILE *fp);
int getchar(void);


// - getc 是宏，更快。fgetc 是函数。
// getchar 等同于 getc(stdin)

```

```c
int ferror(FILE *fp);
int feof(FILE *fp);

void clearerr(FILE *fp);

/*
 * 常见用法:
 *   while ((c = fgetc(fp)) != EOF);
 *   if (feof(fp)) { 正常结束 }
 *   if (ferror(fp)) { 出错处理 }
 */
```

```c
int ungetc(int c, FILE *fp);
```

```c
int putc(int c, FILE *fp);
int fputc(int c, FILE *fp);
int putchar(int c);
```

## 每次一行I/O

推荐用 `fgets` 和 `fputs` 代替 `gets` 和 `puts`。

## 标准I/O的效率

大块读写 `write` 和 `read` 效率更高。

## 二进制I/O

存在内存对齐问题的时候，二进制流可能无法跨系统工作。

## 定位流

```c
int fseek(FILE *fp, long offset, int whence);
long ftell(FILE *fp);
void rewind(FILE *fp);
```

```c
int fgetpos(FILE *fp, fpos_t *pos);
int fsetpos(FILE *fp, const fpos_t *pos);
```

## 格式化I/O

```c
int printf(const char *format, ...);
int fprintf(FILE *stream, const char *format, ...);
int dprintf(int fd, const char *format, ...);
int sprintf(char *str, const char *format, ...);
int snprintf(char *str, size_t size, const char *format, ...);
```

格式说明从 `%` 开始，以一个转换字符结束。

有4个可选择的部分。

```txt
%[flags][fldwidth][precision][lenmodifier]convtype
```

1. flags（可选，多字符，顺序不限）  
   - `-`：左对齐（默认右对齐）  
   - `+`：始终显示符号（如 "+3"）  
   - (空格)：正数前加空格（若有 `+`，则忽略空格）  
   - `0`：数字左侧补零（仅在右对齐时生效）  
   - `#`：增强输出  
     - 对 `o`：非零时前缀 `0`  
     - 对 `x/X`：非零时前缀 `0x` / `0X`  
     - 对浮点类型：保证小数点存在  
     - 对 `g/G`：保留尾部零 :contentReference[oaicite:0]{index=0}

2. width（可选）  
   - 固定数字表示最小字段宽度，内容不足时左填空格（或根据 `0` 标志填零）  
   - 使用 `*` 表示宽度由后续参数提供：`printf("%*d", w, v)` :contentReference[oaicite:1]{index=1}

3. precision（精度，可选）  
   - 对整数 (`d,i,u,o,x,X`)：指定最小数字位数，不足前补 `0`；若 `0` 且 `.0`，则输出空串 :contentReference[oaicite:2]{index=2}  
   - 对浮点 (`e,f,g` 等)：小数点后位数或有效数字总数  
   - 对字符串 (`s`)：最大输出长度  
   - 同样可用 `*` 动态指定 :contentReference[oaicite:3]{index=3}

4. lenmodifier（长度修饰符，可选）  
   - `hh`：对应 `signed char` / `unsigned char`  
   - `h`：对应 `short` / `unsigned short`  
   - (无修饰)：对应 `int` 或 `double`  
   - `l`：对应 `long`、`unsigned long`、`wchar_t*`（用于 `%ls`）  
   - `ll`：对应 `long long`  
   - `j`：对应 `intmax_t`  
   - `z`：对应 `size_t`  
   - `t`：对应 `ptrdiff_t`  
   - `L`：对应 `long double` :contentReference[oaicite:4]{index=4}

5. specifier（必选，转换类型）  
   - `%`：输出 `%`  
   - `d`, `i`：有符号十进制整数  
   - `u`, `o`, `x`, `X`：无符号整数（十进制、八进制、十六进制）  
   - `f`, `F`, `e`, `E`, `g`, `G`, `a`, `A`：浮点数  
   - `c`：字符  
   - `s`：字符串  
   - `p`：指针地址  
   - `n`：将已输出字符数写入对应参数  
   :contentReference[oaicite:5]{index=5}

---

示例演示

```c
printf("|%-8s|\n", "Hi");    // 左对齐，宽度 8
printf("|%+6d|\n", 42);      // 宽度 6，强制加号
printf("|%08.3f|\n", 3.14);  // 宽度 8，精度 3，小数点后补0
printf("|%#x|\n", 48879);    // 前缀 0x
printf("|%.3s|\n", "abcdef"); // 截取 "abc"
```

printf 族的变体。可变参数表换成了arg。

```c
int vprintf(const char *format, va_list ap);
int vfprintf(FILE *stream, const char *format, va_list ap);
int vdprintf(int fd, const char *format, va_list ap);
int vsprintf(char *str, const char *format, va_list ap);
int vsnprintf(char *str, size_t size, const char *format, va_list ap);
```

格式化输入

```txt
%[*][fldwidth][m][lenmodifier]convtype
```

```c
int scanf(const char *format, ...);
int fscanf(FILE *stream, const char *format, ...);
int sscanf(const char *str, const char *format, ...);
```

scanf 族的变体。可变参数表换成了arg。

```c
int vscanf(const char *format, va_list ap);
int vfscanf(FILE *stream, const char *format, va_list ap);
int vsscanf(const char *str, const char *format, va_list ap);
```

## 实现细节

```c
int fileno(FILE *stream);
```

## 临时文件

```c
FILE *tmpfile(void);
char *tmpnam(char *str);
```

```c
char* mkdtemp(char *template); // 创建目录
int mkstemp(char *template); // 创建文件
```

## 内存流

```c
FILE *fmemopen(void *buf, size_t size, const char *mode);
```

**任何时候而要增加流缓冲区中数据重以及调用fclose、fflush、 fseek、 fseeko以及fsetpos时都会在当前位置写入一个null字节。**

```c
FILE *open_memstream(char **bufp, size_t *sizep);
FILE *open_wmemstream(wchar_t **bufp, size_t *sizep);
```

与 `fmemopen` 的区别：

- 创建的流只能写打开
- 不能指定自己的缓冲区，但可以分别通过`bufp`和`sizep`获取缓冲区指针和大小
- 关闭流后需要自行释放缓冲区
- 对流添加字节会增加缓冲区大小

## 标准I/O的替代软件

标准I/O效率不高。衍生了一些替代品。 sfio软件包，mmap函数。

## 小结
