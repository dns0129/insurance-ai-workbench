"""Run with Playwright and CHROMIUM_PATH set; writes only to temporary SQLite."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
out = root / 'test-results' / 'precheck'
out.mkdir(parents=True, exist_ok=True)
code = "import {createApp} from './server.mjs';const {server}=createApp({dbPath:process.env.DB_PATH,env:{}});server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));"
with tempfile.TemporaryDirectory(prefix='precheck-ui-') as tmp:
    server = subprocess.Popen([shutil.which('node'), '--input-type=module', '-e', code], cwd=root,
                              env={**os.environ, 'DB_PATH':str(Path(tmp)/'test.sqlite')}, stdout=subprocess.PIPE, text=True)
    try:
        base = server.stdout.readline().strip()
        assert base.startswith('http://127.0.0.1:')
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'), headless=True)
            leader = browser.new_page(viewport={'width':1440,'height':1050})
            agent = browser.new_page(viewport={'width':1440,'height':1050}, accept_downloads=True)
            errors = []
            for page in [leader, agent]:
                page.on('pageerror', lambda e:errors.append(str(e)))
                page.goto(base, wait_until='networkidle')
            leader.locator('#login-submit').click()
            agent.locator('[name="role"][value="agent"]').check()
            agent.locator('#login-agent').select_option('A006')
            agent.locator('#login-submit').click()
            for page in [leader, agent]:
                page.locator('[data-nav=precheck]').click()
                expect(page.locator('#pc-template')).to_be_visible()
                expect(page.locator('#workspace-actions')).to_be_hidden()
                page.evaluate('document.fonts.ready')
            expect(agent.locator('#pc-editor-form')).to_have_count(0)
            expect(leader.locator('#pc-confirm')).to_have_count(0)
            leader.screenshot(path=str(out/'leader.png'),full_page=True)
            agent.locator('[data-pc=example]').click()
            expect(agent.locator('.pc-result')).to_contain_text('待补 2 项')
            expect(agent.locator('[data-pc=export]')).to_be_disabled()
            agent.locator('#pc-confirm').check()
            agent.locator('[data-pc-item=occupation]').check()
            expect(agent.locator('#pc-confirm')).not_to_be_checked()
            expect(agent.locator('.pc-result')).to_contain_text('待补 1 项')
            agent.locator('#pc-confirm').check()
            leader.locator('[data-pc=add]').click()
            leader.get_by_label('材料 6 名称').fill('虚构补件说明')
            leader.get_by_label('材料 6 核对说明').fill('核对说明表是否已准备。')
            leader.locator('#pc-save').click()
            expect(leader.locator('.pc-panel-head .count')).to_have_text('当前第 2 版')
            agent.locator('[data-pc=export]').click()
            expect(agent.locator('#pc-error')).to_contain_text('已更新清单')
            expect(agent.locator('.pc-items')).to_contain_text('虚构补件说明')
            expect(agent.locator('#pc-confirm')).not_to_be_checked()
            expect(agent.locator('[data-pc=export]')).to_be_disabled()
            agent.locator('[data-pc=example]').click()
            expect(agent.locator('.pc-result')).to_contain_text('待补 3 项')
            agent.screenshot(path=str(out/'agent.png'),full_page=True,style='#notice{display:none}')
            agent.locator('#pc-confirm').check()
            with agent.expect_download() as info:
                agent.locator('[data-pc=export]').click()
            assert info.value.suggested_filename.endswith('v2-预检记录.txt')
            result = Path(info.value.path()).read_text(encoding='utf-8-sig')
            assert '虚构补件说明｜必备｜待补' in result
            assert '确认人：林晓（A006）' in result
            agent.locator('#pc-template').select_option('demo-family')
            expect(agent.locator('.pc-panel-head .count')).to_have_text('第 1 版')
            expect(agent.locator('[data-pc=export]')).to_be_disabled()
            leader.reload(wait_until='networkidle')
            leader.locator('[data-nav=precheck]').click()
            expect(leader.get_by_label('材料 6 名称')).to_have_value('虚构补件说明')
            for page in [leader,agent]:
                for width in [768,375,320]:
                    page.set_viewport_size({'width':width,'height':900})
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert not errors,errors
            browser.close()
            print('通过：团队长编辑与持久化、缺项联动、清单更新阻止旧版导出、人工确认及实际文件下载，320–1440px。')
    finally:
        server.terminate()
        server.wait(timeout=5)
