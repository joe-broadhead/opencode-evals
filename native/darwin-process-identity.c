/* Uncompiled, unqualified platform source. libproc is SDK-exposed, private and
 * changeable: qualify the exact SDK, build and OS runtime before any use. */
#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/proc.h>
#include <sys/types.h>
#include <unistd.h>
#include <stdint.h>
#include <inttypes.h>
#include <limits.h>
#include <errno.h>
#include <stdio.h>

_Static_assert(CHAR_BIT == 8, "ASCII protocol requires eight-bit bytes");
_Static_assert(INT_MAX == 2147483647, "PID protocol requires 32-bit int");
_Static_assert(sizeof(pid_t) == sizeof(int), "PID ABI must match int");
_Static_assert(sizeof(uint64_t) == 8, "start tuple requires uint64_t");
_Static_assert(sizeof(((struct proc_bsdinfo *)0)->pbi_start_tvsec) == 8,
               "SDK start seconds width");
_Static_assert(sizeof(((struct proc_bsdinfo *)0)->pbi_start_tvusec) == 8,
               "SDK start microseconds width");
_Static_assert(PROC_PIDTBSDINFO_SIZE == sizeof(struct proc_bsdinfo),
               "SDK flavor size must match its struct");
_Static_assert(sizeof(struct proc_bsdinfo) <= INT_MAX, "libproc size argument");

int main(int argc, char **argv)
{
    if (argc != 2 || argv[1][0] < '1' || argv[1][0] > '9') return 64;
    int pid = 0;
    unsigned i = 0;
    for (; i < 10 && argv[1][i] != '\0'; ++i) {
        const unsigned char ch = (unsigned char)argv[1][i];
        if (ch < '0' || ch > '9') return 64;
        const int digit = ch - '0';
        if (pid > (INT_MAX - digit) / 10) return 64;
        pid = pid * 10 + digit;
    }
    const pid_t parent = getppid();
    if (argv[1][i] != '\0' || pid < 2 || pid == getpid() || pid == parent) return 64;
    if (getuid() != geteuid() || getgid() != getegid()) return 65;

    struct proc_bsdinfo info = {0};
    errno = 0;
    const int n = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof info);
    /* The wrapper maps syscall failure to zero, not only a negative return. */
    if (n <= 0) return 65;
    if ((size_t)n != sizeof info) return 66;
    if (info.pbi_pid != (uint32_t)pid || parent != getppid() ||
        info.pbi_ppid != (uint32_t)getppid() ||
        info.pbi_uid != geteuid() || info.pbi_ruid != getuid()) return 65;
    if ((info.pbi_status != SRUN && info.pbi_status != SSLEEP &&
         info.pbi_status != SSTOP) || (info.pbi_flags & PROC_FLAG_INEXIT)) return 65;
    if (info.pbi_start_tvsec == 0 || info.pbi_start_tvusec >= 1000000) return 66;

    char record[64];
    const int length = snprintf(record, sizeof record, "QMAC1 %d %" PRIu64 " %06" PRIu64 "\n",
                                pid, info.pbi_start_tvsec, info.pbi_start_tvusec);
    if (length <= 0 || (size_t)length >= sizeof record || length > 45) return 67;
    /* One bounded write, no retry and no stderr or raw struct export. */
    if (write(STDOUT_FILENO, record, (size_t)length) != length) return 67;
    return 0;
}
