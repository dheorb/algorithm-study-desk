const path = require('node:path');
// All files and PIDs belong to this test. The descendant deliberately closes
// stdio and ignores TERM; the direct child retains the default TERM action.
function processTree(directory, exitEarly = false) {
  const pidFile = path.join(directory, 'descendant.pid');
  const beatFile = path.join(directory, 'heartbeat');
  const descendant = `const fs=require('node:fs');process.on('SIGTERM',()=>{});
    fs.appendFileSync(${JSON.stringify(beatFile)},'x');
    fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
    setInterval(()=>fs.appendFileSync(${JSON.stringify(beatFile)},'x'),20);`;
  const code = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});
    ${exitEarly ? `setInterval(()=>{if(require('fs').existsSync(${JSON.stringify(pidFile)}))process.exit(0)},10)` : 'setInterval(()=>{},1000)'};`;
  return { code, pidFile, beatFile };
}
module.exports = { processTree };
