import pathlib, subprocess, sys, json, shutil, os
root=pathlib.Path("/Users/sibraine/Projects/openidea-rainbow-literals")
scratch=pathlib.Path("/tmp/openidea-diff-readiness")
variant=sys.argv[1]
label=sys.argv[2] if len(sys.argv)>2 else variant
scanner=root/"src/editor/core/cm/rainbowBrackets.ts"
files=[root/"e2e/diff.spec.ts",root/"e2e/diff-navigation.spec.ts"]
try:
    source=(scratch/(variant+".ts")).read_text()
    source=";(globalThis as any).__rainbowAuditLoaded = true;\n"+source
    source=source.replace("marks(state: EditorState, from: number, to: number): BracketMark[] {","marks(state: EditorState, from: number, to: number): BracketMark[] {\n (globalThis as any).__rainbowAuditCalls = ((globalThis as any).__rainbowAuditCalls ?? 0) + 1;")
    scanner.write_text(source)
    hook="""\ntest.afterEach(async ({ page }, info) => {
 const audit = await page.evaluate(() => ({loaded:(globalThis as any).__rainbowAuditLoaded ?? false,calls:(globalThis as any).__rainbowAuditCalls ?? 0,panes:[...document.querySelectorAll(".cm-editor")].map(e=>{const c=e.querySelector(".cm-content") as any; const v=c?.cmTile?.view; return {scroll:e.querySelector(".cm-scroller")?.scrollTop,viewport:v?.viewport,head:v?.state.selection.main.head,words:[...e.querySelectorAll(".cm-changedText")].map(x=>x.textContent).slice(0,5)};})})).catch(e=>({error:String(e)}));
 console.log("RAINBOW_AUDIT "+JSON.stringify({title:info.title,repeat:info.repeatEachIndex,status:info.status,audit}));
});\n"""
    for f in files: f.write_text((scratch/f.name).read_text()+hook)
    cmd=["node","/Users/sibraine/Projects/openidea/node_modules/@playwright/test/cli.js","test","e2e/diff.spec.ts","e2e/diff-navigation.spec.ts","--grep","scattered edits, inserts and deletes|centres the visible caret during split navigation","--workers=2","--repeat-each=3"]
    cmd[cmd.index("--grep")+1]=os.environ.get("RAINBOW_AUDIT_GREP",cmd[cmd.index("--grep")+1])
    cmd[-1]="--repeat-each="+os.environ.get("RAINBOW_AUDIT_REPEAT","3")
    with (scratch/(label+".log")).open("w") as out: result=subprocess.run(cmd,cwd=root,stdout=out,stderr=subprocess.STDOUT)
    shutil.copytree(root/"test-results",scratch/(label+"-results"),dirs_exist_ok=True)
    print(json.dumps({"variant":variant,"exit":result.returncode,"log":str(scratch/(variant+".log"))}))
finally:
    scanner.write_text((scratch/"fixed.ts").read_text())
    for f in files: f.write_text((scratch/f.name).read_text())
