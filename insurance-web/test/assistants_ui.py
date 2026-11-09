"""Frontend flow regression; isolated SQLite and browser storage, no model calls.

Run: python test/assistants_ui.py (requires Playwright and Chromium).
"""
from pathlib import Path
import atexit
import os
import shutil
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
out = root / 'test-results' / 'assistants'
out.mkdir(parents=True, exist_ok=True)
temp = tempfile.TemporaryDirectory(prefix='insurance-assistants-')
code = "import {createApp} from './server.mjs';const {server}=createApp({dbPath:process.env.DB_PATH,env:{}});server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));"
server = subprocess.Popen([shutil.which('node'), '--input-type=module', '-e', code], cwd=root,
    env={**os.environ, 'DB_PATH':str(Path(temp.name) / 'test.sqlite')}, stdout=subprocess.PIPE, text=True)

def cleanup():
    server.terminate()
    server.wait(timeout=5)
    temp.cleanup()

atexit.register(cleanup)
base = server.stdout.readline().strip()
assert base.startswith('http://127.0.0.1:'), base
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome'), headless=True)
    page = browser.new_page(viewport={'width':1440, 'height':1050})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(base, wait_until='networkidle')
    page.locator('#login-submit').click()
    expect(page.locator('.member-card')).to_have_count(3)
    page.locator('[data-nav="assistants"]').click()
    expect(page.locator('#assistant-section')).to_be_visible()
    expect(page.locator('.introtools')).to_be_hidden()
    expect(page.locator('.a-rail-files button')).to_have_count(2)
    page.screenshot(path=str(out / 'product-welcome.png'), full_page=True)
    page.locator('[data-aprompt="团队目前有哪些产品？"]').click()
    expect(page.locator('.a-reply')).to_have_count(1)
    expect(page.locator('.a-reply')).to_contain_text('适合进一步沟通')
    expect(page.locator('.a-followup')).to_contain_text('年龄段')
    expect(page.locator('.a-attachment')).to_have_count(2)
    with page.expect_download() as info:
        page.locator('.a-download').first.click()
    download = info.value
    assert Path(download.path()).read_bytes().startswith(b'%PDF-')
    page.locator('.a-attachment [data-adoc]').first.click()
    expect(page.locator('.a-dialog')).to_contain_text('仅供交互演示')
    response = page.request.get(base + page.locator('.a-dialog a[target="_blank"]').get_attribute('href'))
    assert response.ok and response.headers['content-type'] == 'application/pdf'
    page.locator('.a-dialog [data-aaction="close-dialog"]').click()
    page.locator('#a-messages').evaluate('(e)=>e.scrollTop=0')
    page.screenshot(path=str(out / 'product-answer.png'), full_page=True)
    page.locator('[data-aaction="new-chat"]').click()
    page.locator('#a-question').fill('明天的天气如何？')
    page.locator('#a-question').press('Enter')
    expect(page.locator('.a-reply')).to_contain_text('没有覆盖这个问题')
    expect(page.locator('.a-attachment')).to_have_count(0)

    page.locator('#a-tab-product').focus()
    page.keyboard.press('ArrowRight')
    expect(page.locator('#a-tab-team')).to_have_attribute('aria-selected', 'true')
    page.locator('.a-prompts [data-aprompt="介绍一下公司和团队"]').click()
    expect(page.locator('.a-reply')).to_contain_text('等待团队提供正式公司简介')
    page.locator('.a-follow-chips [data-aprompt="晋升流程是怎样的？"]').click()
    expect(page.locator('.a-reply').last).to_contain_text('当前有效的职级与晋升制度')
    page.locator('.a-follow-chips [data-aprompt="佣金如何发放和核对？"]').last.click()
    expect(page.locator('.a-reply').last).to_contain_text('到账日期以正式制度为准')
    page.locator('.a-topics [data-aprompt="工作台怎么使用？"]').click()
    expect(page.locator('.a-reply').last).to_contain_text('客户档案')

    page.locator('#a-tab-objection').click()
    page.locator('#a-customer-product').select_option('安心医疗保障（示例）')
    page.locator('#a-customer-stage').select_option('方案沟通')
    page.locator('#a-customer-note').fill('已有单位医保，重视住院开支')
    for prompt, text in [('客户觉得保费太高','长期安排'),('客户说已经有保险了','没有缺口'),('客户担心理赔问题','合同和审核为准'),('客户想对比其他产品','缺少竞品资料')]:
        page.locator('#a-question').fill(prompt)
        page.locator('#a-question').press('Enter')
        expect(page.locator('.a-reply').last).to_contain_text(text)
        expect(page.locator('.a-reply').last).to_contain_text('已有单位医保')
    page.locator('#a-messages').evaluate('(e)=>e.scrollTop=Math.max(0,e.scrollHeight-650)')
    page.screenshot(path=str(out / 'objection.png'), full_page=True)

    page.locator('[data-nav="knowledge"]').click()
    expect(page.locator('.a-file-table tbody tr')).to_have_count(4)
    expect(page.locator('#assistant-section')).to_be_visible()
    page.locator('[data-aaction="upload"]').click()
    page.locator('#a-upload-input').set_input_files({'name':'错误文件.pdf','mimeType':'application/pdf','buffer':b'not a pdf'})
    expect(page.locator('#a-upload-error')).to_contain_text('不是有效的 PDF')
    expect(page.locator('#a-upload-save')).to_be_disabled()
    sample = (root / 'public' / 'demo' / 'medical.pdf').read_bytes()
    page.locator('#a-upload-input').set_input_files({'name':'团队测试.pdf','mimeType':'application/pdf','buffer':sample})
    page.locator('#a-upload-category').select_option('team')
    page.locator('#a-upload-save').click()
    expect(page.locator('.a-dialog')).to_have_count(0)
    row = page.locator('.a-file-table tbody tr').filter(has_text='团队测试.pdf')
    expect(row).to_contain_text('待解析')
    expect(row).to_contain_text('公司与团队')
    expect(page.locator('.a-file-table tbody tr')).to_have_count(5)
    page.reload(wait_until='networkidle')
    page.locator('[data-nav="knowledge"]').click()
    expect(page.locator('.a-file-table tbody tr')).to_have_count(5)
    row = page.locator('.a-file-table tbody tr').filter(has_text='团队测试.pdf')
    row.locator('.a-file-name').click()
    with page.expect_download() as info:
        page.locator('.a-dialog a[download]').click()
    assert Path(info.value.path()).read_bytes() == sample
    page.locator('.a-dialog [data-aaction="close-dialog"]').click()
    row.locator('[data-aedit]').click()
    page.locator('#a-category-form select').select_option('objection')
    page.locator('#a-category-form .black').click()
    expect(row).to_contain_text('异议处理')
    page.locator('#a-file-search').fill('团队测试')
    expect(page.locator('.a-file-table tbody tr')).to_have_count(1)
    page.locator('#a-file-search').fill('没有这个文件')
    expect(page.locator('.a-file-empty')).to_be_visible()
    page.locator('[data-aaction="clear-filters"]').click()
    page.locator('[data-atoggle="demo-medical"]').click()
    expect(page.locator('.a-file-table tbody tr').filter(has_text='安心医疗')).to_contain_text('演示已停用')
    page.screenshot(path=str(out / 'knowledge.png'), full_page=True)
    page.locator('[data-nav="assistants"]').click()
    page.locator('#a-tab-product').click()
    page.locator('[data-aprompt="医疗保障适合哪些客户？"]').click()
    expect(page.locator('.a-reply')).to_contain_text('没有与问题匹配')
    expect(page.locator('.a-attachment')).to_have_count(0)
    page.locator('[data-nav="knowledge"]').click()
    page.locator('[data-atoggle="demo-medical"]').click()
    row = page.locator('.a-file-table tbody tr').filter(has_text='团队测试.pdf')
    row.locator('[data-adelete]').click()
    page.locator('[data-aconfirmdelete]').click()
    expect(page.locator('.a-file-table tbody tr')).to_have_count(4)

    for section in ['assistants','knowledge']:
        page.locator(f'[data-nav="{section}"]').click()
        for width in [1024,768,375,320]:
            page.set_viewport_size({'width':width,'height':1000})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'{section} overflow at {width}'
        page.screenshot(path=str(out / f'{section}-mobile.png'), full_page=True)
    page.set_viewport_size({'width':1440,'height':1050})
    page.locator('[data-nav="assistants"]').click()
    page.locator('#a-tab-product').click()
    page.locator('[data-aaction="new-chat"]').click()
    page.locator('[data-aprompt="团队目前有哪些产品？"]').click()
    # Switch identity while the response is pending; the old session must not reappear.
    page.locator('#switch-account').click()
    page.locator('[name="role"][value="agent"]').check()
    page.locator('#login-agent').select_option('A006')
    page.locator('#login-submit').click()
    expect(page.locator('#nav-knowledge')).to_be_hidden()
    page.locator('[data-nav="assistants"]').click()
    page.wait_for_timeout(600)  # Observe beyond the pending response from the old account.
    expect(page.locator('.a-reply')).to_have_count(0)
    expect(page.locator('.a-manage-link')).to_have_count(0)
    expect(page.locator('.a-rail-note')).to_contain_text('由团队长')
    page.locator('#main-nav [data-nav="ai"]').click()
    page.locator('[data-question="留存分析"]').click()
    expect(page.locator('#ai-answer')).to_contain_text('【模拟分析】')
    assert not errors, errors
    browser.close()
    print('PASS: three assistants, citations/PDF downloads, unknown questions, file persistence/classification/removal, disabled sources, account isolation, legacy AI and 320–1440px layouts')
