---
title: "TOCTTOU竞态条件安全漏洞详解"
categories:
  - C++与系统编程
---

## 引言

在系统编程中，TOCTTOU（Time-of-Check to Time-of-Use）是一类非常危险且常见的竞态条件安全漏洞。这种漏洞发生在程序检查某个条件（Check）和实际使用（Use）该条件之间的时间窗口内，攻击者可以恶意修改检查对象的状态，从而绕过安全检查，导致权限提升、文件篡改等严重后果。

## TOCTTOU的基本概念

### 定义

TOCTTOU（Time-of-Check to Time-of-Use）是指程序在**检查时间点**和**使用时间点**之间存在时间窗口，在这个窗口内，被检查的对象状态可能发生改变，导致程序基于过时的检查结果进行操作。

### 攻击原理

```text
时间线：
T1: 程序检查条件 (Check)    → 条件满足
T2: [时间窗口]             → 攻击者修改状态
T3: 程序基于T1的结果使用 (Use) → 实际条件已不满足
```

攻击者利用T1和T3之间的时间差，在T2时刻恶意修改被检查对象的状态，使程序在T3时刻执行了不安全的操作。

## 经典的文件系统TOCTTOU漏洞

### 基础示例

最经典的TOCTTOU漏洞出现在文件操作中：

```c
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>

int vulnerable_file_access(const char* filename) {
    struct stat st;
    
    // Check: 检查文件状态
    if (stat(filename, &st) == -1) {
        return -1;
    }
    
    // 检查是否为普通文件
    if (!S_ISREG(st.st_mode)) {
        fprintf(stderr, "Error: Not a regular file\n");
        return -1;
    }
    
    // 检查文件大小
    if (st.st_size > MAX_FILE_SIZE) {
        fprintf(stderr, "Error: File too large\n");
        return -1;
    }
    
    // *** 危险的时间窗口 ***
    // 攻击者可以在此处：
    // 1. 删除原文件
    // 2. 创建指向敏感文件的符号链接
    // 3. 或者替换为设备文件等
    
    // Use: 基于之前的检查结果打开文件
    int fd = open(filename, O_RDWR);
    if (fd == -1) {
        return -1;
    }
    
    // 对文件进行写操作（可能写入敏感文件）
    write(fd, "malicious data", 14);
    close(fd);
    
    return 0;
}
```

### 攻击场景分析

假设有一个以root权限运行的程序，使用上述代码处理`/tmp/user_data`文件：

1. **T1时刻**: 程序检查`/tmp/user_data`，确认为普通文件且大小合适
2. **T2时刻**: 攻击者快速执行：

   ```bash
   rm /tmp/user_data
   ln -s /etc/passwd /tmp/user_data
   ```

3. **T3时刻**: 程序基于T1的检查结果，打开`/tmp/user_data`，实际打开了`/etc/passwd`
4. **结果**: 程序向`/etc/passwd`写入了恶意数据，可能导致系统被攻破

## 更复杂的TOCTTOU场景

### 目录操作中的TOCTTOU

```c
int vulnerable_temp_file_creation() {
    char temp_dir[] = "/tmp/app_XXXXXX";
    
    // Check: 创建临时目录
    if (mkdtemp(temp_dir) == NULL) {
        return -1;
    }
    
    // Check: 验证目录权限
    struct stat st;
    if (stat(temp_dir, &st) == -1) {
        return -1;
    }
    
    if (st.st_uid != getuid() || (st.st_mode & 0777) != 0700) {
        fprintf(stderr, "Directory permissions incorrect\n");
        return -1;
    }
    
    // *** 危险窗口 ***
    // 攻击者可以：
    // 1. 删除目录，创建符号链接指向敏感目录
    // 2. 修改目录权限
    
    // Use: 在目录中创建敏感文件
    char temp_file[PATH_MAX];
    snprintf(temp_file, sizeof(temp_file), "%s/sensitive_data", temp_dir);
    
    int fd = open(temp_file, O_CREAT | O_WRONLY, 0600);
    if (fd != -1) {
        write(fd, "sensitive information", 21);
        close(fd);
    }
    
    return 0;
}
```

### 网络编程中的TOCTTOU

```c
int vulnerable_socket_bind(const char* socket_path) {
    struct stat st;
    
    // Check: 检查socket文件是否存在
    if (stat(socket_path, &st) == 0) {
        // 文件存在，检查是否为socket
        if (!S_ISSOCK(st.st_mode)) {
            fprintf(stderr, "Path exists but not a socket\n");
            return -1;
        }
        
        // 删除旧的socket文件
        if (unlink(socket_path) == -1) {
            return -1;
        }
    }
    
    // *** 危险窗口 ***
    // 攻击者可以在此处创建文件或符号链接
    
    // Use: 创建新的socket
    int sockfd = socket(AF_UNIX, SOCK_STREAM, 0);
    struct sockaddr_un addr;
    addr.sun_family = AF_UNIX;
    strcpy(addr.sun_path, socket_path);
    
    if (bind(sockfd, (struct sockaddr*)&addr, sizeof(addr)) == -1) {
        close(sockfd);
        return -1;
    }
    
    return sockfd;
}
```

## TOCTTOU防护技术

### 1. 使用原子操作

最有效的防护方法是使用原子操作，消除检查和使用之间的时间窗口：

```c
// 安全的文件操作
int safe_file_access(const char* filename) {
    // 直接打开文件，使用O_NOFOLLOW防止符号链接攻击
    int fd = open(filename, O_RDWR | O_NOFOLLOW);
    if (fd == -1) {
        if (errno == ELOOP) {
            fprintf(stderr, "Error: Symbolic link detected\n");
        }
        return -1;
    }
    
    // 在已打开的文件描述符上进行检查
    struct stat st;
    if (fstat(fd, &st) == -1) {
        close(fd);
        return -1;
    }
    
    // 检查文件类型（在fd上，不会被攻击者改变）
    if (!S_ISREG(st.st_mode)) {
        fprintf(stderr, "Error: Not a regular file\n");
        close(fd);
        return -1;
    }
    
    // 检查文件大小
    if (st.st_size > MAX_FILE_SIZE) {
        fprintf(stderr, "Error: File too large\n");
        close(fd);
        return -1;
    }
    
    // 安全地进行文件操作
    write(fd, "safe data", 9);
    close(fd);
    
    return 0;
}
```

### 2. 使用*at系列函数

Linux提供的`*at`系列函数可以基于目录文件描述符进行相对路径操作，避免路径被替换：

```c
int safe_file_operation_with_at(const char* dir_path, const char* filename) {
    // 打开目录
    int dirfd = open(dir_path, O_RDONLY);
    if (dirfd == -1) {
        return -1;
    }
    
    // 使用openat在目录内打开文件
    int fd = openat(dirfd, filename, O_RDWR | O_NOFOLLOW);
    if (fd == -1) {
        close(dirfd);
        return -1;
    }
    
    // 使用fstatat检查文件状态
    struct stat st;
    if (fstatat(dirfd, filename, &st, AT_SYMLINK_NOFOLLOW) == -1) {
        close(fd);
        close(dirfd);
        return -1;
    }
    
    // 进行安全的文件操作
    if (S_ISREG(st.st_mode) && st.st_size <= MAX_FILE_SIZE) {
        write(fd, "safe data", 9);
    }
    
    close(fd);
    close(dirfd);
    return 0;
}
```

### 3. 文件锁定机制

使用文件锁来确保操作的原子性：

```c
int safe_file_with_locking(const char* filename) {
    int fd = open(filename, O_RDWR | O_CREAT, 0644);
    if (fd == -1) {
        return -1;
    }
    
    // 获取排他锁
    struct flock lock;
    lock.l_type = F_WRLCK;
    lock.l_whence = SEEK_SET;
    lock.l_start = 0;
    lock.l_len = 0;  // 锁定整个文件
    
    if (fcntl(fd, F_SETLKW, &lock) == -1) {
        close(fd);
        return -1;
    }
    
    // 在锁定状态下进行检查和操作
    struct stat st;
    if (fstat(fd, &st) == -1) {
        close(fd);
        return -1;
    }
    
    if (S_ISREG(st.st_mode) && st.st_size <= MAX_FILE_SIZE) {
        write(fd, "locked operation", 16);
    }
    
    // 锁会在close时自动释放
    close(fd);
    return 0;
}
```

### 4. 临时文件安全创建

```c
int safe_temp_file_creation() {
    char template[] = "/tmp/app_XXXXXX";
    
    // mkstemp原子性地创建临时文件
    int fd = mkstemp(template);
    if (fd == -1) {
        return -1;
    }
    
    // 设置安全的文件权限
    if (fchmod(fd, 0600) == -1) {
        close(fd);
        unlink(template);
        return -1;
    }
    
    // 安全地操作文件
    write(fd, "temporary data", 14);
    
    close(fd);
    // 使用完毕后删除临时文件
    unlink(template);
    
    return 0;
}
```

## 实际漏洞案例分析

### 案例1：经典的/tmp竞态条件

许多程序在处理临时文件时存在TOCTTOU漏洞：

```c
// 漏洞代码示例
void vulnerable_temp_processing() {
    const char* temp_file = "/tmp/app_data";
    
    // 检查文件是否存在
    if (access(temp_file, F_OK) == 0) {
        // 文件存在，删除它
        unlink(temp_file);
    }
    
    // *** 攻击窗口 ***
    // 攻击者可以创建符号链接指向/etc/passwd
    
    // 创建新文件并写入数据
    int fd = open(temp_file, O_CREAT | O_WRONLY, 0644);
    write(fd, "application data", 16);
    close(fd);
}
```

**攻击脚本**：

```bash
#!/bin/bash
# 攻击脚本：利用时间窗口
while true; do
    if [ ! -e /tmp/app_data ]; then
        ln -s /etc/passwd /tmp/app_data
        sleep 0.001
        rm -f /tmp/app_data 2>/dev/null
    fi
done
```

### 案例2：SetUID程序中的权限提升

```c
// 具有SUID权限的程序
int main(int argc, char* argv[]) {
    if (argc != 2) {
        fprintf(stderr, "Usage: %s <config_file>\n", argv[0]);
        return 1;
    }
    
    const char* config_file = argv[1];
    
    // 检查文件所有者（错误的安全检查）
    struct stat st;
    if (stat(config_file, &st) == -1) {
        perror("stat");
        return 1;
    }
    
    // 确保文件属于调用用户
    if (st.st_uid != getuid()) {
        fprintf(stderr, "Error: File not owned by user\n");
        return 1;
    }
    
    // *** TOCTTOU漏洞窗口 ***
    // 攻击者可以替换文件为指向敏感文件的符号链接
    
    // 以root权限打开并处理文件
    FILE* fp = fopen(config_file, "r");
    if (fp) {
        char buffer[1024];
        // 处理配置文件内容...
        fclose(fp);
    }
    
    return 0;
}
```

## 检测工具和方法

### 1. 静态分析工具

使用静态分析工具检测潜在的TOCTTOU漏洞：

```bash
# 使用cppcheck检测
cppcheck --enable=all --std=c11 source_file.c

# 使用clang静态分析器
clang --analyze -Xanalyzer -analyzer-checker=security source_file.c
```

### 2. 动态检测

编写测试脚本验证TOCTTOU漏洞：

```bash
#!/bin/bash
# TOCTTOU漏洞测试脚本

TARGET_FILE="/tmp/test_file"
SENSITIVE_FILE="/etc/passwd"

# 创建测试文件
echo "normal data" > $TARGET_FILE

# 后台运行攻击循环
while true; do
    if [ -f $TARGET_FILE ]; then
        rm -f $TARGET_FILE
        ln -s $SENSITIVE_FILE $TARGET_FILE
        sleep 0.01
        rm -f $TARGET_FILE
        echo "normal data" > $TARGET_FILE
    fi
    sleep 0.01
done &

ATTACK_PID=$!

# 运行目标程序
./vulnerable_program $TARGET_FILE

# 清理
kill $ATTACK_PID
rm -f $TARGET_FILE
```

## 最佳实践总结

### 1. 编程原则

- **最小权限原则**：程序只获取必要的最小权限
- **原子操作**：尽可能使用原子操作避免检查-使用分离
- **输入验证**：对所有外部输入进行严格验证
- **错误处理**：妥善处理所有可能的错误情况

### 2. 具体建议

```c
// 推荐的安全编程模式
int secure_file_operation(const char* filename) {
    // 1. 使用安全的打开标志
    int fd = open(filename, O_RDWR | O_NOFOLLOW | O_NOCTTY);
    if (fd == -1) {
        return handle_error("Failed to open file");
    }
    
    // 2. 在文件描述符上进行检查
    struct stat st;
    if (fstat(fd, &st) == -1) {
        close(fd);
        return handle_error("Failed to stat file");
    }
    
    // 3. 验证文件属性
    if (!validate_file_properties(&st)) {
        close(fd);
        return handle_error("File validation failed");
    }
    
    // 4. 执行安全操作
    int result = perform_file_operation(fd);
    
    close(fd);
    return result;
}
```
