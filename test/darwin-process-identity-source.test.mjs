// STATIC SOURCE CHECKS ONLY. This does not compile C, model libproc, or prove ABI/runtime behavior.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("uncompiled C source keeps the single SDK-struct read and bounded record contract",()=>{
  const c=readFileSync(new URL("../native/darwin-process-identity.c",import.meta.url),"utf8")
  for(const header of ["libproc.h","sys/proc_info.h","sys/proc.h","stdint.h","inttypes.h","limits.h","unistd.h"])assert.ok(c.includes(`#include <${header}>`))
  assert.equal((c.match(/\bproc_pidinfo\s*\(/g)||[]).length,1)
  assert.match(c,/struct proc_bsdinfo info = \{0\}/)
  assert.match(c,/proc_pidinfo\(pid, PROC_PIDTBSDINFO, 0, &info, sizeof info\)/)
  for(const fragment of ["argc != 2","i < 10","INT_MAX - digit","pid < 2","pid == getpid()","pid == parent","getuid() != geteuid()","getgid() != getegid()","errno = 0","n <= 0","n != sizeof info","PROC_PIDTBSDINFO_SIZE","info.pbi_pid != (uint32_t)pid","info.pbi_ppid != (uint32_t)getppid()","info.pbi_uid != geteuid()","info.pbi_ruid != getuid()","info.pbi_status != SRUN","info.pbi_status != SSLEEP","info.pbi_status != SSTOP","info.pbi_flags & PROC_FLAG_INEXIT","info.pbi_start_tvsec == 0","info.pbi_start_tvusec >= 1000000","char record[64]","snprintf","write(STDOUT_FILENO","return 64","return 65","return 66","return 67","return 0"])assert.ok(c.includes(fragment),fragment)
  assert.ok((c.match(/_Static_assert/g)||[]).length>=4)
  assert.doesNotMatch(c,/\b(atoi|strtol|fork|exec\w*|system|popen|sysctl|kill|sleep|socket|getenv|fprintf|perror)\s*\(/)
  assert.doesNotMatch(c,/struct proc_bsdinfo\s*\{/)
})
