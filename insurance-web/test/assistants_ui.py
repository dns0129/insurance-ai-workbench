"""Browser regression: real upload/retrieval, synthetic model, separate team roles."""
from pathlib import Path
import atexit
import os
import shutil
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
out = root / "test-results" / "assistants"
out.mkdir(parents=True, exist_ok=True)
temp = tempfile.TemporaryDirectory(prefix="insurance-assistants-")
code = """
import {createApp} from './server.mjs';
import {quoteProvider,makePdf} from './test/knowledge-fixture.mjs';
import {writeFileSync} from 'node:fs';
writeFileSync(process.env.FIXTURE_PATH,makePdf([
  'New agent onboarding - internal training sample.',
  'ORBIT onboarding: use the amber guide to request account access.'
]));
const {server}=createApp({dbPath:process.env.DB_PATH,env:{},knowledgeProvider:quoteProvider()});
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));
"""
fixture = Path(temp.name) / "ORBIT团队操作指南.pdf"
server = subprocess.Popen(
    [os.environ.get("WORKBENCH_NODE") or shutil.which("node"), "--input-type=module", "-e", code],
    cwd=root,
    env={**os.environ, "DB_PATH": str(Path(temp.name) / "test.sqlite"), "FIXTURE_PATH": str(fixture)},
    stdout=subprocess.PIPE,
    text=True,
)

def cleanup():
    server.terminate()
    server.wait(timeout=5)
    temp.cleanup()

atexit.register(cleanup)
base = server.stdout.readline().strip()
assert base.startswith("http://127.0.0.1:"), base

def ask(page, value):
    page.locator("#a-question").fill(value)
    page.locator("#a-question").press("Enter")
    expect(page.locator("#a-messages")).to_have_attribute("aria-busy", "false")
    return page.locator(".a-reply").last

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get("CHROMIUM_PATH") or shutil.which("chromium") or shutil.which("google-chrome"),
        headless=True,
    )
    context = browser.new_context(viewport={"width": 1440, "height": 1050}, reduced_motion="reduce")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(base, wait_until="networkidle")
    page.locator("#login-submit").click()
    expect(page.locator(".member-card")).to_have_count(3)
    page.locator('[data-nav="assistants"]').click()
    expect(page.get_by_role("tab", name="产品知识助手")).to_have_attribute("aria-selected", "true")
    expect(page.get_by_role("heading",name="团队 AI 助理")).to_have_count(0)
    expect(page.locator("#workspace-actions")).to_be_hidden()
    assert page.locator(".a-tabs").bounding_box()["y"] < 85
    for width, height in [(1440, 1050), (1280, 720), (375, 680)]:
        page.set_viewport_size({"width":width,"height":height})
        expect(page.locator("#a-question")).to_be_in_viewport(ratio=1)
        expect(page.locator(".a-composer .black")).to_be_in_viewport(ratio=1)
        assert page.evaluate("document.documentElement.scrollHeight <= innerHeight")
    page.set_viewport_size({"width":1440,"height":1050})
    panel = page.locator("#a-pdf-panel")
    toggle = page.locator("#a-preview-toggle")
    expect(toggle).to_have_attribute("aria-expanded", "false")
    toggle.click()
    expect(panel.locator(".a-pdf-files button")).to_have_count(2)
    panel.get_by_role("button", name="收起 PDF 预览").click()
    expect(panel).to_be_hidden()
    page.emulate_media(reduced_motion="no-preference")
    reply = ask(page, "团队目前有哪些产品？")
    expect(reply).to_have_attribute("data-playing", "")
    expect(reply.locator(".a-reply-summary strong")).not_to_be_empty()
    expect(reply.locator(".a-sources")).to_be_hidden()
    reply.get_by_role("button", name="显示全文").click()
    expect(reply.get_by_role("button", name="显示全文")).to_be_hidden()
    expect(reply).to_contain_text("示例资料练习")
    expect(reply.locator(".a-cite").first).to_be_visible()
    page.emulate_media(reduced_motion="reduce")

    documents = page.request.get(base+"/api/knowledge/documents").json()["documents"]
    medical = next(doc for doc in documents if doc["id"] == "demo-medical")
    critical = next(doc for doc in documents if doc["id"] == "demo-critical")
    sample = {
        "status": "grounded", "title": "五款产品概览", "intro": "请按条款核对保障。", "sample": True,
        "sources": [
            {**medical, "page": 1, "ref": "X1", "excerpt": "产品目录 CY-MED-01 CY-CI-02"},
            {**critical, "page": 2, "ref": "X2", "excerpt": "澄心重大疾病 CY-CI-02"},
        ],
        "blocks": [{"title":"产品说明", "text":"针对此处的保障范围核对原文。", "items":[
            "**医疗类 `CY-MED-01`**：核对住院津贴。", "澄心重大疾病 CY-CI-02：核对等待期。", "缺少依据 CY-CI-021：待补充资料。"
        ], "citations":["X1", "X2"]}],
    }
    page.route("**/api/knowledge/ask", lambda route:route.fulfill(json=sample))
    reply = ask(page, "产品链接排版检查")
    links = reply.locator(".a-product-link")
    expect(links).to_have_count(2)
    expect(links.first).to_have_text("医疗类 CY-MED-01")
    expect(links.first).to_have_css("font-weight","700")
    expect(links.first).to_have_css("text-decoration-line","underline")
    expect(reply.locator("li strong")).to_have_text("缺少依据 CY-CI-021")
    expect(links.last).to_have_attribute("href", critical["url"]+"#page=2")
    page.evaluate("() => document.fonts.ready")
    cdp = context.new_cdp_session(page)
    cdp.send("DOM.enable")
    cdp.send("CSS.enable")
    document_node = cdp.send("DOM.getDocument")["root"]["nodeId"]
    for selector, weight in [(".a-reply:last-of-type h3", "Bold"), (".a-reply:last-of-type .a-answer-block > p", "Regular")]:
        node = cdp.send("DOM.querySelector", {"nodeId":document_node, "selector":selector})["nodeId"]
        fonts = cdp.send("CSS.getPlatformFontsForNode", {"nodeId":node})["fonts"]
        assert fonts and all(f["isCustomFont"] and f["postScriptName"].endswith(weight) for f in fonts), fonts
    links.last.click()
    expect(panel.locator("canvas")).to_have_attribute("aria-label", "PDF 第 2 页")
    page.screenshot(path=str(out / "product-links.png"), full_page=True, animations="disabled")
    panel.get_by_role("button", name="收起 PDF 预览").click()
    page.unroute("**/api/knowledge/ask")

    page.locator("#a-tab-product").focus()
    page.keyboard.press("ArrowRight")
    expect(page.locator("#a-tab-team")).to_have_attribute("aria-selected", "true")
    reply = ask(page, "佣金如何发放和核对？")
    expect(reply).to_contain_text("晋升与佣金流程")
    expect(reply.locator(".a-cite").first).to_have_text("X1 · 第 2 页")
    with page.expect_response(lambda r: r.url.endswith('/demo-team/file')) as response:
        reply.locator(".a-cite").first.click()
    assert response.value.ok
    assert response.value.headers['content-type'] == 'application/pdf'
    expect(panel).to_contain_text("引用位置：第 2 页")
    canvas = panel.locator("canvas")
    expect(canvas).to_have_attribute("aria-label", "PDF 第 2 页")
    page.screenshot(path=str(out / "pdf-preview.png"), full_page=True, animations="disabled")
    expect(page.locator("#notice")).to_be_hidden()
    link = panel.get_by_role("link", name="在新标签打开")
    assert link.get_attribute("href").endswith("#page=2")
    with page.expect_download() as info:
        panel.get_by_role("link", name="下载 PDF").click()
    assert Path(info.value.path()).read_bytes().startswith(b"%PDF-")
    chat_box = page.locator("#a-tabpanel").bounding_box()
    panel_box = panel.bounding_box()
    assert panel_box["x"] >= chat_box["x"]+chat_box["width"]
    panel.get_by_role("button",name="下一页").click()
    expect(canvas).to_have_attribute("aria-label", "PDF 第 3 页")
    panel.get_by_role("button",name="上一页").click()
    expect(canvas).to_have_attribute("aria-label", "PDF 第 2 页")
    width = canvas.bounding_box()["width"]
    panel.get_by_role("button",name="放大").click()
    expect(panel.locator(".a-pdf-scroll")).to_be_visible()
    page.wait_for_function("width => document.querySelector('#a-pdf-panel canvas').getBoundingClientRect().width > width",arg=width)
    viewer = panel.locator(".a-pdf-viewer")
    viewer.evaluate("element => element.dataset.opened = 'yes'")
    expect(ask(page, "明天的天气如何？")).to_contain_text("暂未找到足够的团队资料")
    expect(viewer).to_have_attribute("data-opened","yes")
    panel.get_by_role("button", name="收起 PDF 预览").click()
    expect(panel).to_be_hidden()
    toggle.click()
    expect(viewer).to_have_attribute("data-opened","yes")
    page.set_viewport_size({"width":375,"height":900})
    expect(page.locator("#a-pdf-panel:modal")).to_be_visible()
    page.wait_for_function("() => document.querySelector('#a-pdf-panel canvas')?.getBoundingClientRect().width < 500")
    expect(canvas).to_have_attribute("aria-label", "PDF 第 2 页")
    panel.get_by_role("button",name="缩小").click()
    page.wait_for_function("() => document.querySelector('#a-pdf-panel canvas')?.getBoundingClientRect().width < 355")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path=str(out / "pdf-preview-mobile.png"), animations="disabled")
    page.keyboard.press("Escape")
    expect(panel).to_be_hidden()
    expect(toggle).to_be_focused()
    page.set_viewport_size({"width":1440,"height":1050})

    page.locator("#a-tab-objection").click()
    expect(page.get_by_text("补充沟通背景")).to_have_count(0)
    with page.expect_request(lambda req: "/knowledge/ask" in req.url) as request:
        reply = ask(page, "客户觉得保费太高")
    assert "background" not in request.value.post_data_json
    expect(reply).to_contain_text("保费与已有保障")
    expect(reply.locator(".a-script .reply-section-icon").first).to_be_visible()
    page.screenshot(path=str(out / "objection.png"), full_page=True)

    page.locator('[data-nav="knowledge"]').click()
    expect(page.locator(".a-file-table tbody tr")).to_have_count(4)
    page.get_by_role("button", name="上传 PDF").click()
    page.locator("#a-upload-input").set_input_files({"name": "错误文件.pdf", "mimeType": "application/pdf", "buffer": b"not a pdf"})
    expect(page.locator("#a-upload-error")).to_contain_text("不是有效的 PDF")
    expect(page.locator("#a-upload-save")).to_be_disabled()
    page.locator("#a-upload-input").set_input_files(str(fixture))
    page.locator("#a-upload-category").select_option("team")
    page.locator("#a-upload-save").click()
    expect(page.get_by_role("dialog")).to_have_count(0)
    row = page.locator(".a-file-table tbody tr").filter(has_text=fixture.name)
    expect(row).to_contain_text("已启用")
    expect(row).to_contain_text("2 个片段")
    page.reload(wait_until="networkidle")
    page.locator('[data-nav="knowledge"]').click()
    expect(row).to_be_visible()
    page.get_by_role("button", name="试查资料").click()
    page.locator("#a-probe-category").select_option("team")
    page.locator("#a-probe-query").fill("amber")
    page.get_by_role("button", name="检索", exact=True).click()
    cited = page.locator(".a-probe-results summary")
    expect(cited).to_contain_text(fixture.name)
    cited.click()
    expect(page.locator(".a-probe-results")).to_contain_text("amber guide")
    page.evaluate("window.scrollTo(0, 0)")
    page.screenshot(path=str(out / "knowledge.png"), full_page=True, animations="disabled")

    row.get_by_role("button", name="分类").click()
    page.get_by_role("dialog").locator("select").select_option("objection")
    page.get_by_role("button", name="保存分类").click()
    expect(row).to_contain_text("异议处理")
    page.locator("#switch-account").click()
    page.locator('input[name="role"][value="agent"]').check()
    page.locator("#login-submit").click()
    expect(page.locator("#nav-knowledge")).to_be_hidden()
    page.locator('[data-nav="assistants"]').click()
    page.locator("#a-tab-objection").click()
    expect(ask(page, "amber")).to_contain_text("ORBIT onboarding")
    expect(page.get_by_role("button", name="管理团队知识库")).to_have_count(0)
    page.locator("#switch-account").click()
    page.locator('input[name="role"][value="leader"]').check()
    page.locator("#login-submit").click()
    page.locator('[data-nav="knowledge"]').click()
    row.get_by_role("button", name="停用").click()
    expect(row).to_contain_text("已停用")
    page.locator('[data-nav="assistants"]').click()
    page.locator("#a-tab-objection").click()
    expect(ask(page, "amber")).to_contain_text("暂未找到足够的团队资料")
    page.locator('[data-nav="knowledge"]').click()
    row.get_by_role("button", name="移除").click()
    page.get_by_role("button", name="确认移除").click()
    expect(row).to_have_count(0)

    page.locator("#notice").evaluate("(el) => {el.hidden = true;}")
    for width in [768, 375, 320]:
        page.set_viewport_size({"width": width, "height": 900})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
        page.locator('[data-nav="assistants"]').click()
        expect(page.locator("#a-tab-objection")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), width
        page.evaluate("window.scrollTo(0, 0)")
        page.screenshot(path=str(out / f"assistant-{width}.png"), full_page=True, animations="disabled")
        page.locator('[data-nav="knowledge"]').click()
    assert not errors, errors
    print("助手、上传、检索、引用、下载、账号权限和 320–1440px 布局通过。")
    browser.close()
