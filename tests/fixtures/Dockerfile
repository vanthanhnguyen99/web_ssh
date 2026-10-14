FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server && rm -rf /var/lib/apt/lists/* && useradd -m -s /bin/bash lab && echo 'lab:fixture-password' | chpasswd && mkdir -p /run/sshd /home/lab/.ssh && chown -R lab:lab /home/lab/.ssh
COPY sshd_config /etc/ssh/sshd_config
COPY start.sh /start.sh
CMD ["sh", "/start.sh"]
