# agentbench-os 上游环境：Linux guest，预置 check.sh 需要的用户、文件和测试目录。
# 用法见 README.md。
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        bash \
        coreutils \
        findutils \
        util-linux \
    && rm -rf /var/lib/apt/lists/*

# shared-file-permissions 题需要的四个用户（jack/bill/tom 可读，george 不可读）
RUN groupadd guest-readers \
    && for user in jack bill tom george; do useradd -m "$user"; done \
    && usermod -a -G guest-readers jack \
    && usermod -a -G guest-readers bill \
    && usermod -a -G guest-readers tom \
    && echo "test" > /testfile \
    && chown root:root /testfile \
    && chmod 600 /testfile

# recursive-permissions 题的种子目录（root 作为评测执行用户时 ~ == /root）
RUN mkdir -p /root/videos/sub \
    && echo alpha > /root/videos/a.txt \
    && echo beta > /root/videos/sub/b.txt \
    && touch /root/videos/empty.log \
    && chmod -R 644 /root/videos \
    && find /root/videos -type d -exec chmod 755 {} \;

# 交付目录：Agent 产出的命令/脚本挂载到这里，由 run_checks.sh 安装后执行 check.sh
RUN mkdir -p /agent

WORKDIR /agent
