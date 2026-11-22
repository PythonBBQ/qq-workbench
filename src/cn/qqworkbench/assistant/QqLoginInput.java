package cn.qqworkbench.assistant;

import android.app.AlertDialog;
import android.content.Context;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.widget.*;
import org.json.JSONObject;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Native editors provide a real Android input connection beside the VNC canvas. */
final class QqLoginInput {
    final QqLoginWindow owner;
    AlertDialog dialog;
    QqLoginInput(QqLoginWindow owner){this.owner=owner;}
    boolean current(){return owner.current()&&!owner.paused&&owner.loaded&&QqWindowProbe.allowed(owner.slot,owner.web.getUrl());}
    void install(){if(!current())return;try(InputStream in=owner.a.getAssets().open("qq-login-keyboard.js")){
        String script=new String(LocalVoice.read(in,16384),StandardCharsets.UTF_8);owner.web.evaluateJavascript(script,null);
    }catch(Exception e){owner.a.toast("登录输入组件未加载，请重新打开 QQ 窗口");}}
    void keyboard(){if(!current()){owner.a.toast("请等待 QQ 登录窗口就绪");return;}
        owner.web.requestFocus();owner.web.evaluateJavascript("Boolean(window.qqwbLoginInput && window.qqwbLoginInput.showKeyboard())",result->{
            if(!current())return;if(!"true".equals(result)){owner.a.toast("请点账号或密码框，再使用上方输入按钮");return;}
            InputMethodManager imm=(InputMethodManager)owner.a.getSystemService(Context.INPUT_METHOD_SERVICE);
            if(imm!=null)imm.showSoftInput(owner.web,InputMethodManager.SHOW_IMPLICIT);
        });
    }
    void edit(boolean password){if(!current()){owner.a.toast("请等待 QQ 登录窗口就绪");return;}
        owner.web.evaluateJavascript("Boolean(window.qqwbLoginInput && window.qqwbLoginInput.ready())",result->{
            if(!current())return;if(!"true".equals(result)){owner.a.toast("QQ 桌面尚未连接，请稍后重试");return;}
            showEditor(password);
        });
    }
    void showEditor(boolean password){close();MainActivity a=owner.a;EditText field=new EditText(a);
        field.setSingleLine(true);field.setHint(password?"QQ 密码":"QQ 账号");field.setSaveEnabled(false);
        field.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        field.setInputType(password?(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD):InputType.TYPE_CLASS_NUMBER);
        field.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_DONE|android.view.inputmethod.EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
        LinearLayout box=new LinearLayout(a);box.setPadding(a.dp(20),0,a.dp(20),0);box.addView(field,new LinearLayout.LayoutParams(-1,-2));
        AlertDialog next=new AlertDialog.Builder(a).setTitle(password?"输入 QQ 密码":"输入 QQ 账号")
            .setMessage("请先点中下方 QQ 窗口里对应的输入框。确认后仅填入文字，登录仍由你点击。")
            .setView(box).setNegativeButton("取消",null).setPositiveButton("填入 QQ",null).create();dialog=next;
        next.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        next.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE|WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        next.setOnDismissListener(d->{field.setText("");if(dialog==next)dialog=null;});
        next.setOnShowListener(d->{next.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            String value=field.getText().toString();if(value.isEmpty()||value.length()>512||value.matches("(?s).*[\\x00-\\x1f\\x7f].*")||(!password&&!value.matches("[0-9]{5,20}"))){field.setError(password?"请输入有效密码":"请输入5至20位 QQ 账号");return;}
            if(!current()){next.dismiss();return;}
            owner.web.evaluateJavascript("Boolean(window.qqwbLoginInput && window.qqwbLoginInput.sendText("+JSONObject.quote(value).replace("\u2028","\\u2028").replace("\u2029","\\u2029")+"))",ok->{
                if(!current())return;if("true".equals(ok)){next.dismiss();a.toast("已填入，请在 QQ 窗口确认登录");}else field.setError("QQ 连接已变化，请关闭后重新选择输入框");
            });
        });field.requestFocus();field.postDelayed(()->{if(next.isShowing()){InputMethodManager imm=(InputMethodManager)a.getSystemService(Context.INPUT_METHOD_SERVICE);if(imm!=null)imm.showSoftInput(field,InputMethodManager.SHOW_IMPLICIT);}},200);});
        next.show();
    }
    void close(){if(dialog!=null){dialog.dismiss();dialog=null;}}
}
