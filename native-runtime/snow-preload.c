/* Private-container compatibility loader. Loads the unchanged upstream module in
 * the QQ process itself; no remote process attach or system permission changes. */
typedef unsigned long pthread_t;
extern int pthread_create(pthread_t *, const void *, void *(*)(void *), void *);
extern int pthread_detach(pthread_t);
extern unsigned int sleep(unsigned int);
extern int open(const char *, int, ...);
extern long read(int, void *, unsigned long);
extern long write(int, const void *, unsigned long);
extern int close(int);
extern int getpid(void);
extern char *getenv(const char *);
extern char *strstr(const char *, const char *);
extern unsigned long strlen(const char *);
extern int snprintf(char *, unsigned long, const char *, ...);
extern void *dlopen(const char *, int);
extern void *dlsym(void *, const char *);
extern char *dlerror(void);

static void status(const char *text) {
    char path[256];
    const char *dir=getenv("SNOWLUMA_HOOK_RUNTIME_DIR");
    if(!dir)dir=getenv("XDG_RUNTIME_DIR");
    if(!dir)dir="/tmp/qqwb-runtime";
    snprintf(path,sizeof(path),"%s/qqwb-snow-status-%d",dir,getpid());
    int fd=open(path,1|64|512,0600);
    if(fd>=0){write(fd,text,strlen(text));close(fd);}
}
static void *start(void *unused) {
    (void)unused;
    // Let QQ reserve its graphics/IPC address ranges before loading native code.
    sleep(20);
    void *lib=dlopen("/opt/snowluma/native/snowluma-linux-arm64.so",2|256);
    if(!lib){const char *error=dlerror();status(error?error:"dlopen failed");return 0;}
    int (*load)(void)=(int (*)(void))dlsym(lib,"snowluma_linux_hook_start_dynamic");
    if(!load){status("dynamic entry missing");return 0;}
    int loaded=load();
    status(loaded?"dynamic entry returned loaded":"dynamic entry returned not loaded");
    return 0;
}
__attribute__((constructor)) static void init(void) {
    if(!getenv("QQWB_SNOW_PRELOAD_ENABLE"))return;
    char cmd[4096]={0};int fd=open("/proc/self/cmdline",0);
    if(fd<0)return;
    long n=read(fd,cmd,sizeof(cmd)-1);close(fd);
    if(n<=0||!strstr(cmd,"/qq"))return;
    for(long i=0;i<n;i++)if(!cmd[i])cmd[i]=' ';
    if(strstr(cmd,"--type="))return;
    pthread_t thread;
    if(!pthread_create(&thread,0,start,0))pthread_detach(thread);
}
