const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const electron=require('electron');
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
const kill=pid=>{try{process.kill(pid,'SIGKILL');}catch{}};
(async()=>{
  for(const mode of ['app','ipc']){
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lume-quit-'));
    const report=path.join(directory,'report.json');let details;
    const child=spawn(electron,[path.join(__dirname,'quit-fixture.cjs'),mode],{env:{...process.env,LUME_QUIT_USER_DATA:directory,LUME_QUIT_REPORT:report},stdio:['ignore','pipe','pipe']});
    let errors='';child.stderr.on('data',data=>{errors+=data.toString().slice(0,4096);});child.stdout.resume();
    const timer=setTimeout(()=>kill(child.pid),20000);
    try{
      const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
      assert.equal(code,0,errors);details=JSON.parse(fs.readFileSync(report));
      assert.equal(details.windows,2,'quit while independent settings is open');
      assert.equal(alive(details.helperPid),false,'owned helper must be gone before application exit');
      assert.equal(alive(details.userPid),true,'user-launched program must stay running');
      console.log(`Quit ${mode} passed: application exits, two windows close, helper gone, external program retained.`);
    }finally{
      clearTimeout(timer);
      if(!details&&fs.existsSync(report))details=JSON.parse(fs.readFileSync(report));
      if(details){kill(details.helperPid);kill(details.userPid);}
      fs.rmSync(directory,{recursive:true,force:true});
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
