package cn.qqworkbench.assistant;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.widget.*;
import java.io.*;
import java.util.*;
import org.json.*;

final class BackupScreens {
    static void show(MainActivity a){
        a.base("备份与迁移","backup");
        a.section("换设备，记忆一起带走","包含全部账号已保存的对话、长期记忆、语音偏好、学习笔记、人设、模型卡与密钥、拉黑、表情备注、自定义声音和背景。");
        a.note("备份由你设置的密码加密，不上传云端。另一台设备安装工作台后，在这里导入即可；请记住密码。");
        a.primary("导出加密备份",()->choose(a,false));a.button("导入备份并切换",()->choose(a,true));
        a.section("切换说明","");a.note("导出时短暂停止QQ服务，结束后恢复原运行状态。切换设备前请停止旧设备；新设备可能需要重新登录QQ，并单独授予后台权限。");
        a.note("导入会替换目标设备的记忆和配置；目标原数据会另存一份加密备份。不会复制待执行任务、发送队列、系统授权或QQ设备登录凭据。");
        File previous=new File(a.getFilesDir(),"migration-before-restore.qqwb");
        if(previous.isFile())a.button("导出上次导入前的原数据",()->a.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/octet-stream").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,"QQWorkbench-before-restore.qqwb"),82));
        a.settingLink("存储清理","清理可重建的试听与临时文件","storage");
    }
    static void choose(MainActivity a,boolean importing){
        if(DataMigration.busy){a.toast("备份或迁移正在进行");return;}
        LinearLayout box=new LinearLayout(a);box.setOrientation(1);box.setPadding(a.dp(22),0,a.dp(22),0);
        EditText password=new EditText(a);password.setSingleLine(true);password.setInputType(129);password.setHint(importing?"输入备份密码":"设置备份密码（至少8位）");box.addView(password);
        EditText repeat=new EditText(a);repeat.setSingleLine(true);repeat.setInputType(129);repeat.setHint("再输入一次密码");if(!importing)box.addView(repeat);
        TextView hint=a.text(importing?"原数据会先留存一份加密备份，再导入新数据。":"文件包含聊天与API密钥，请妥善保存文件和密码。",14);box.addView(hint);
        AlertDialog dialog=new AlertDialog.Builder(a).setTitle(importing?"导入备份":"导出备份").setView(box).setNegativeButton("取消",null).setPositiveButton("选择文件",null).create();
        dialog.setOnShowListener(v->dialog.getButton(-1).setOnClickListener(view->{String value=password.getText().toString();if(value.length()<8||value.length()>256){password.setError("密码需为8–256位");return;}if(!importing&&!value.equals(repeat.getText().toString())){repeat.setError("两次密码不一致");return;}
            if(a.migrationPassword!=null)Arrays.fill(a.migrationPassword,'\0');a.migrationPassword=value.toCharArray();password.setText("");repeat.setText("");dialog.dismiss();
            try{Intent intent=new Intent(importing?Intent.ACTION_OPEN_DOCUMENT:Intent.ACTION_CREATE_DOCUMENT).setType("application/octet-stream").addCategory(Intent.CATEGORY_OPENABLE);if(!importing)intent.putExtra(Intent.EXTRA_TITLE,"QQWorkbench-"+new java.text.SimpleDateFormat("yyyyMMdd-HHmm",Locale.ROOT).format(new Date())+".qqwb");a.startActivityForResult(intent,importing?81:80);}catch(Exception e){Arrays.fill(a.migrationPassword,'\0');a.migrationPassword=null;a.toast("文件选择器不可用");}
        }));dialog.show();
    }
    static void result(MainActivity a,int request,int result,Intent data){
        char[] password=a.migrationPassword;a.migrationPassword=null;
        if(result!=Activity.RESULT_OK||data==null||data.getData()==null){if(password!=null)Arrays.fill(password,'\0');return;}
        Uri uri=data.getData();
        if(request==82){a.io.submit(()->{try(InputStream in=new FileInputStream(new File(a.getFilesDir(),"migration-before-restore.qqwb"));OutputStream out=a.getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException();MigrationArchive.copy(in,out,MigrationArchive.MAX+8*1024*1024);a.runOnUiThread(()->a.toast("原数据备份已导出，密码为上次导入使用的密码"));}catch(Exception e){a.runOnUiThread(()->a.toast("备份导出失败"));}});return;}
        if(password==null){a.toast("密码已释放，请重新选择备份操作");return;}
        synchronized(DataMigration.class){if(DataMigration.busy){Arrays.fill(password,'\0');a.toast("备份或迁移正在进行");return;}DataMigration.busy=true;}
        a.base(request==80?"正在备份":"正在迁移","backupProgress");a.section("请保持应用打开",request==80?"正在停止原会话并保存加密备份…":"正在解密和校验文件；完成校验前不会改动现有数据。");
        a.loginOffered=true;
        a.io.submit(()->{
            File stage=new File(a.getCacheDir(),"migration-import-"+UUID.randomUUID());boolean requested=a.getSharedPreferences("runtime",0).getBoolean("requested",false),stopped=false;String message;
            try{
                JSONObject manifest=null;if(request==81)try(InputStream in=a.getContentResolver().openInputStream(uri)){if(in==null)throw new IOException("无法读取备份");manifest=MigrationArchive.read(in,stage,password);}
                stopped=true;DataMigration.stop(a);
                if(request==80)try(OutputStream out=a.getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException("无法写入备份");DataMigration.exportData(a,out,password);}
                else DataMigration.importData(a,stage,manifest,password);
                message=request==80?"加密备份已保存，可传到另一台设备导入。":"记忆和配置已导入。请停止旧设备，再在本机连接QQ。";
            }catch(Exception e){message="操作未完成："+(e.getMessage()==null?"文件不可读或密码不正确":e.getMessage());}
            finally{
                Arrays.fill(password,'\0');try{MigrationArchive.erase(stage);}catch(Exception ignored){}
                DataMigration.busy=false;if(stopped&&!DataMigration.transaction(a).exists())DataMigration.resume(a,requested);
            }
            final String text=message;a.runOnUiThread(()->{if(a.destroyed)return;a.loginOffered=false;a.photo=PhotoBackground.load(a);a.background=a.theme().getInt("background",0xfff0f6fa);a.drafts.clear();show(a);a.note(text);a.toast(text);});
        });
    }
}
