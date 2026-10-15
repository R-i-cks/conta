"""Optional end-to-end checks: uv run --with playwright python browser_test.py.

Starts its own server on a spare port against a throwaway workspace file, so it
never reads or overwrites real finances.
"""
import atexit
import json
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

PORT = 4273
BASE = f"http://127.0.0.1:{PORT}"
WORKSPACE = Path(tempfile.mkdtemp(prefix="conta-test-")) / "conta-data.json"


def fresh_workspace():
    """Each scenario starts from nothing. The file is the shared record now, so
    clearing browser storage alone no longer isolates a browser context."""
    WORKSPACE.unlink(missing_ok=True)


# start.py steps aside for an existing server, which would hand these tests
# somebody else's workspace, so claim the port before asking it to serve.
with socket.socket() as probe:
    if probe.connect_ex(("127.0.0.1", PORT)) == 0:
        raise SystemExit(f"port {PORT} is already serving; stop that process and retry")

server = subprocess.Popen(
    [sys.executable, "-u", str(Path(__file__).parent / "start.py"),
     "--no-browser", "--port", str(PORT), "--data", str(WORKSPACE)],
    stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
atexit.register(server.terminate)
for _attempt in range(100):
    try:
        urllib.request.urlopen(BASE + "/health", timeout=1).read()
        break
    except (urllib.error.URLError, OSError):
        time.sleep(0.1)
else:
    raise SystemExit(f"test server did not start on {PORT}")


with sync_playwright() as p:
    browser = p.chromium.launch()
    fresh_workspace()
    context = browser.new_context(reduced_motion="reduce", viewport={"width": 1440, "height": 1100})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("dialog", lambda dialog: dialog.accept())
    page.goto(BASE, wait_until="load")
    expect(page.locator("#demo-banner")).to_be_visible()
    expect(page.locator("#recent-list .recent-item")).to_have_count(4)
    assert page.locator(".chart-bar").first.bounding_box()["height"] > 20
    page.screenshot(path="/tmp/conta-desktop.png", full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    page.screenshot(path="/tmp/conta-mobile.png", full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.set_viewport_size({"width": 1440, "height": 1100})

    page.locator("#start-fresh").click()
    expect(page.locator("#demo-banner")).to_be_hidden()
    expect(page.locator("#recent-list .recent-item")).to_have_count(0)

    page.locator('nav a[href="#accounts"]').click()
    page.locator("#add-account").click()
    account = page.locator("#account-form")
    account.locator('[name="name"]').fill("Test current")
    account.locator('[name="bank"]').fill("Test bank")
    account.locator('[name="opening"]').fill("0")
    account.get_by_role("button", name="Save account").click()
    page.locator('nav a[href="#overview"]').click()

    def add(description, amount, kind, category):
        page.locator("#overview .add-transaction").click()
        form = page.locator("#transaction-form")
        form.locator('[name="description"]').fill(description)
        form.locator('[name="amount"]').fill(amount)
        form.locator('[name="type"]').select_option(kind)
        form.locator('[name="category"]').select_option(category)
        form.locator('[name="accountId"]').select_option(label="Test current")
        form.get_by_role("button", name="Save transaction").click()
        expect(page.locator("#transaction-dialog")).not_to_be_visible()

    add("Salary test", "2500.29", "income", "Salary")
    add('<img src=x onerror="alert(1)">', "100.01", "expense", "Groceries")
    assert page.locator("#recent-list img").count() == 0
    expect(page.locator("#balance")).to_contain_text("2400,28")
    expect(page.locator("#transaction-rows tr").first).to_contain_text(re.compile(r"\d{2}/\d{2}/\d{4}"))
    expect(page.locator("#spending .ring-center strong")).to_contain_text("100,01")
    expect(page.locator("#spending .spending-row")).to_have_count(1)
    expect(page.locator("#spending .spending-row")).to_contain_text("Groceries")
    expect(page.locator("#assets")).to_contain_text("2400,28")
    page.reload()
    expect(page.locator("#recent-list .recent-item")).to_have_count(2)
    page.locator('nav a[href="#transactions"]').click()
    page.locator("#search").fill("Salary test")
    expect(page.locator("#transaction-rows tr")).to_have_count(1)
    page.get_by_role("button", name="Edit Salary test", exact=True).click()
    page.locator('#transaction-form [name="amount"]').fill("3000.29")
    page.locator("#transaction-form").get_by_role("button", name="Save transaction").click()
    expect(page.locator("#transaction-rows")).to_contain_text("000,29")
    page.locator("#search").fill("")
    page.locator("#type-filter").select_option("expense")
    expect(page.locator("#transaction-rows tr")).to_have_count(1)
    with page.expect_download() as download_info:
        page.locator("#export-csv").click()
    csv = Path(download_info.value.path()).read_text()
    assert "100.01" in csv and "Salary test" not in csv
    page.locator("#type-filter").select_option("all")

    page.locator('nav a[href="#tax"]').click()
    page.locator("#taxable-income").fill("100000")
    page.locator("#tax-form").get_by_role("button", name="Calculate estimate").click()
    expect(page.locator("#tax-result")).to_contain_text("500,00")
    expect(page.locator("#bracket-rows tr.current")).to_contain_text("09")
    page.locator("#taxation").select_option("joint")
    page.locator("#taxable-income").fill("200000")
    page.locator("#tax-form").get_by_role("button", name="Calculate estimate").click()
    expect(page.locator("#tax-result")).to_contain_text("Joint taxation")
    expect(page.locator("#tax-result")).to_contain_text("000,00")
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path="/tmp/conta-tax-mobile.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 1100})

    # Accounts and transfers are independent of spending and income totals.
    page.locator('nav a[href="#accounts"]').click()
    for name, opening in [("Everyday", "1000"), ("Savings", "500")]:
        page.locator("#add-account").click()
        account = page.locator("#account-form")
        account.locator('[name="name"]').fill(name)
        account.locator('[name="bank"]').fill("Test bank")
        account.locator('[name="opening"]').fill(opening)
        account.get_by_role("button", name="Save account").click()
    expect(page.locator("#account-cards .account-card")).to_have_count(3)
    cash_before_transfer = page.locator("#total-cash").inner_text()
    page.locator("#add-transfer").click()
    page.locator('#transfer-form [name="amount"]').fill("200")
    page.locator("#transfer-form").get_by_role("button", name="Save transfer").click()
    expect(page.locator("#transfer-rows tr")).to_have_count(1)
    expect(page.locator("#total-cash")).to_have_text(cash_before_transfer)
    page.locator('nav a[href="#transactions"]').click()
    page.get_by_role("button", name="Edit Salary test", exact=True).click()
    page.locator("#transaction-account").select_option(label="Everyday")
    page.locator("#transaction-form").get_by_role("button", name="Save transaction").click()
    page.locator('nav a[href="#accounts"]').click()
    expect(page.locator("#total-cash")).to_contain_text("4400,28")

    page.locator('nav a[href="#portfolio"]').click()
    page.route("**/quotes?**", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps({"quotes":{"TEST":{"price":125,"currency":"EUR","date":date.today().isoformat()}},"errors":{}})))
    page.locator("#add-holding").click()
    holding = page.locator("#holding-form")
    for name, value in {"name":"Test ETF", "symbol":"TEST", "broker":"Broker", "units":"2.5", "price":"120", "cost":"250"}.items():
        holding.locator(f'[name="{name}"]').fill(value)
    holding.locator('[name="autoPrice"]').check()
    holding.get_by_role("button", name="Save investment").click()
    expect(page.locator("#portfolio-value")).to_contain_text("300,00")
    expect(page.locator("#portfolio-gain")).to_contain_text("50,00")
    page.locator("#refresh-prices").click()
    expect(page.locator("#portfolio-value")).to_contain_text("312,50")
    expect(page.locator("#holding-rows")).to_contain_text("Automatic")
    page.get_by_role("button", name="Edit TEST", exact=True).click()
    holding.locator('[name="price"]').fill("130")
    holding.get_by_role("button", name="Save investment").click()
    expect(page.locator("#portfolio-gain")).to_contain_text("75,00")
    page.locator("#save-snapshot").click()
    assert len(page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).snapshots")) == 1
    with page.expect_download() as portfolio_download:
        page.locator("#export-holdings").click()
    assert '"TEST"' in Path(portfolio_download.value.path()).read_text()
    page.screenshot(path="/tmp/conta-portfolio.png", full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path="/tmp/conta-portfolio-mobile.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 1100})

    # Stocks: a stubbed /stock answer drives the per-ticker view for a holding and a watched ticker.
    def stock_body(symbol):
        days, day = [], date.today() - timedelta(days=740)
        while len(days) < 510:
            if day.weekday() < 5:
                days.append(day.isoformat())
            day += timedelta(days=1)
        closes = [100 - i * 0.15 if i < 200 else 70 + (i - 200) * 0.12 for i in range(510)]
        return json.dumps({"symbol": symbol, "name": f"{symbol} Company", "currency": "EUR", "exchange": "Lisbon", "type": "EQUITY", "price": closes[-1], "previousClose": closes[-2], "updated": days[-1],
                           "dates": days, "closes": closes, "adjusted": closes, "highs": [c * 1.01 for c in closes], "lows": [c * 0.99 for c in closes], "volumes": [1000] * 510, "opens": closes,
                           "fundamentals": {"price": {"marketCap": 1.5e9}, "summaryDetail": {"trailingPE": 12.5}, "financialData": {"targetLowPrice": 90, "targetMeanPrice": 110, "targetHighPrice": 130, "numberOfAnalystOpinions": 3, "recommendationKey": "buy"}}})
    page.route("**/stock?**", lambda route: route.fulfill(status=200, content_type="application/json", body=stock_body(route.request.url.split("symbol=")[1])))
    page.locator("#add-holding").click()
    holding.locator('[name="updated"]').fill("")
    holding.locator('[name="symbol"]').fill("FILL")
    holding.locator('[name="broker"]').focus()
    expect(holding.locator('[name="name"]')).to_have_value("FILL Company")
    expect(holding.locator('[name="price"]')).to_have_value("107.08")
    assert holding.locator('[name="updated"]').input_value()
    holding.get_by_role("button", name="Cancel", exact=True).click()
    # Adding the same ticker again merges into the existing holding as a recorded purchase.
    page.locator("#add-holding").click()
    for name, value in {"name":"Test ETF again", "symbol":"test", "broker":"Broker", "units":"1", "price":"100", "cost":"100"}.items():
        holding.locator(f'[name="{name}"]').fill(value)
    holding.get_by_role("button", name="Save investment").click()
    expect(page.locator("#holding-dialog")).to_be_hidden()
    expect(page.locator("#holding-rows tr")).to_have_count(1)
    assert len(page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).contributions")) == 1
    page.get_by_role("link", name="Analyse TEST").click()
    expect(page.locator("#stock-detail")).to_contain_text("Price paid")
    expect(page.locator("#stock-detail")).to_contain_text("3.5 units")
    expect(page.locator("#stock-detail .stock-head h2")).to_contain_text("TEST Company")
    expect(page.locator("#stock-detail .flag-list li")).not_to_have_count(0)
    expect(page.locator("#stock-detail")).to_contain_text("above its 50-day and 200-day averages")
    expect(page.locator("#stock-detail > article").first.locator("svg polyline")).to_have_count(3)
    expect(page.locator("#stock-detail")).to_contain_text("Patterns")
    expect(page.locator("#stock-detail")).to_contain_text("Average cost 100")
    expect(page.locator("#benchmark-table tbody tr")).to_have_count(4)
    expect(page.locator("#benchmark-table")).to_contain_text("VWCE.DE")
    expect(page.locator("#benchmark-panel svg polyline")).to_have_count(2)
    assert page.locator("#stock-detail details").get_attribute("open") is None
    expect(page.locator("#stock-detail")).not_to_contain_text("Trend continues")
    thesis = page.locator("#thesis-form")
    thesis.locator('[name="why"]').fill("Durable demand <test>")
    thesis.locator('[name="allocation"]').fill("25")
    thesis.locator('[name="review"]').fill("28/02/2027")
    thesis.get_by_role("button", name="Save thesis").click()
    assert thesis.locator('[name="review"]').evaluate("(e) => [e.value, Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').get.call(e)]") == ["2027-02-28", "28/02/2027"]
    expect(page.locator("#stock-detail")).to_contain_text("over limit")
    thesis.locator('[name="note"]').fill("Review margins")
    thesis.get_by_role("button", name="Add note", exact=True).click()
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).theses.TEST.review") == "2027-02-28"
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).theses.TEST.notes[0].text") == "Review margins"
    before_preview = page.evaluate("localStorage.getItem('conta-v1')")
    cash_text = page.locator("#trade-preview strong").last.inner_text()
    page.locator('#trade-form [name="amount"]').fill("107.08")
    expect(page.locator("#trade-preview strong").first).to_have_text("4.5")
    assert page.locator("#trade-preview strong").last.inner_text() != cash_text
    page.locator('#trade-form [name="side"]').select_option("sell")
    expect(page.locator("#trade-preview strong").first).to_have_text("2.5")
    page.locator('#trade-form [name="amount"]').fill("99999")
    expect(page.locator("#trade-preview")).to_contain_text("Sale exceeds")
    assert page.evaluate("localStorage.getItem('conta-v1')") == before_preview
    page.locator('#benchmark-form [name="symbol"]').fill("test")
    page.locator("#benchmark-form").get_by_role("button", name="Save benchmark").click()
    expect(page.locator("#benchmark-table tbody tr").first.locator("td").last).to_have_text("0")
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).benchmark") == "TEST"
    page.locator("#watch-form [name=symbol]").fill("galp.ls")
    page.locator("#watch-form").get_by_role("button", name="Watch").click()
    expect(page.locator("#stock-detail .stock-head h2")).to_contain_text("GALP.LS Company")
    expect(page.locator("#stock-rows tr")).to_have_count(2)
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).watchlist") == ["GALP.LS"]
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path="/tmp/conta-stocks-mobile.png", full_page=True)
    page.set_viewport_size({"width": 1440, "height": 1100})
    page.screenshot(path="/tmp/conta-stocks.png", full_page=True)
    page.get_by_role("button", name="Stop watching GALP.LS").click()
    expect(page.locator("#stock-rows tr")).to_have_count(1)
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).watchlist") == []

    # The requested salary profile: age 24, first eligible year, meal card.
    page.locator('nav a[href="#accounts"]').click()
    for name, kind in [("Salary account", "Current"), ("Meal card", "Meal card")]:
        page.locator("#add-account").click()
        account = page.locator("#account-form")
        account.locator('[name="name"]').fill(name)
        account.locator('[name="bank"]').fill("Test bank")
        account.locator('[name="kind"]').select_option(kind)
        account.locator('[name="opening"]').fill("0")
        account.get_by_role("button", name="Save account").click()
    page.locator('nav a[href="#tax"]').click()
    payroll = page.locator("#payroll-form")
    payroll.locator('[name="gross"]').fill("1300")
    payroll.locator('[name="bankAccountId"]').select_option(label="Salary account")
    payroll.locator('[name="mealAccountId"]').select_option(label="Meal card")
    payroll.locator('[name="mealDaily"]').fill("9.60")
    payroll.locator('[name="mealDays"]').fill("22")
    payroll.locator('[name="youth"]').check()
    payroll.locator('[name="age"]').fill("24")
    payroll.locator('[name="eligible"]').check()
    payroll.locator('[name="employerApplied"]').check()
    payroll.get_by_role("button", name="Calculate take-home pay").click()
    expect(page.locator("#payroll-result .tax-total")).to_contain_text("368,20")
    expect(page.locator("#payroll-result")).to_contain_text("143,00")
    payroll.locator('[name="payments"]').select_option("12")
    payroll.get_by_role("button", name="Calculate take-home pay").click()
    expect(page.locator("#payroll-result .tax-total")).to_contain_text("561,03")
    # The annual calculator can start from the salary settings instead of a typed guess.
    page.locator("#fill-from-salary").click()
    expect(page.locator("#taxable-source")).to_contain_text("specific deduction (CIRS 25)")
    expect(page.locator("#taxable-source")).to_contain_text("IRS Jovem exemption")
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).tax.taxable") == 0
    page.screenshot(path="/tmp/conta-payroll.png", full_page=True)
    page.set_viewport_size({"width": 320, "height": 700})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.set_viewport_size({"width": 1440, "height": 1100})

    page.locator('nav a[href="#settings"]').click()
    with page.expect_download() as download_info:
        page.locator("#backup").click()
    backup = Path(download_info.value.path()).read_bytes()
    assert len(json.loads(backup)["transactions"]) == 2
    assert len(json.loads(backup)["accounts"]) == 5
    assert len(json.loads(backup)["holdings"]) == 1
    page.locator("#clear-data").click()
    page.locator("#restore").set_input_files({"name": "backup.json", "mimeType": "application/json", "buffer": backup})
    # Clearing already shows the ready toast, so wait for the restored records themselves.
    for _ in range(100):
        if len(page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).transactions")) == 2:
            break
        page.wait_for_timeout(100)
    assert len(page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).transactions")) == 2, page.locator("#toast").text_content()
    assert len(page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).holdings")) == 1
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).payroll.payments") == 12
    page.locator("#restore").set_input_files({"name": "bad.json", "mimeType": "application/json", "buffer": b'{"version": 1}'})
    expect(page.locator("#toast")).to_contain_text("Could not import")
    assert len(page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).transactions")) == 2

    page.locator('nav a[href="#transactions"]').click()
    page.get_by_role("button", name="Delete Salary test", exact=True).click()
    expect(page.locator("#transaction-rows tr").filter(has_not_text="Scheduled")).to_have_count(1)
    page.reload()
    expect(page.locator("#transaction-rows tr").filter(has_not_text="Scheduled")).to_have_count(1)
    page.set_viewport_size({"width": 320, "height": 700})
    page.screenshot(path="/tmp/conta-narrow.png", full_page=True)
    if page.evaluate("document.documentElement.scrollWidth > innerWidth"):
        print(page.evaluate("Array.from(document.querySelectorAll('body *')).filter(e=>e.getBoundingClientRect().right>innerWidth && e.getBoundingClientRect().width).map(e=>[e.tagName,e.id,e.className,e.getBoundingClientRect().right]).slice(0,30)"))
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")

    # A full or blocked browser store is no longer fatal: the file is the record,
    # so the save must still reach the server.
    page.evaluate("() => { Storage.prototype.setItem = function() { throw new Error('Quota exceeded'); }; }")
    page.locator('nav a[href="#overview"]').click()
    page.locator("#overview .add-transaction").click()
    page.locator('#transaction-form [name="description"]').fill("Saved without the cache")
    page.locator('#transaction-form [name="amount"]').fill("1")
    page.locator("#transaction-form").get_by_role("button", name="Save transaction").click()
    expect(page.locator("#transaction-dialog")).not_to_be_visible()
    expect(page.locator("#toast")).to_contain_text("Transaction saved")
    page.wait_for_timeout(400)
    assert any(t["description"] == "Saved without the cache"
               for t in json.loads(page.request.get(BASE + "/data").text())["transactions"])

    # A save the server refuses must never look like it succeeded.
    page.route("**/data", lambda route: route.abort() if route.request.method == "PUT" else route.continue_())
    page.locator("#overview .add-transaction").click()
    page.locator('#transaction-form [name="description"]').fill("Server refuses this")
    page.locator('#transaction-form [name="amount"]').fill("2")
    page.locator("#transaction-form").get_by_role("button", name="Save transaction").click()
    expect(page.locator("#toast")).to_contain_text("the app server did not accept it")
    page.unroute("**/data")
    assert not any(t["description"] == "Server refuses this"
                   for t in json.loads(page.request.get(BASE + "/data").text())["transactions"])
    assert not errors, errors
    # Fresh storage for planning and loan scenarios.
    fresh_workspace()
    context = browser.new_context(reduced_motion="reduce", viewport={"width": 1440, "height": 1050})
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("dialog", lambda dialog: dialog.accept())
    page.goto(BASE, wait_until="load")
    page.locator("#start-fresh").click()
    page.locator('nav a[href="#loans"]').click()
    page.locator("#add-loan").click()
    loan = page.locator("#loan-form")
    loan.locator('[name="kind"]').select_option("car")
    expect(loan.locator('[name="interestTax"]')).to_have_value("4")
    loan.locator('[name="rateType"]').select_option("fixed")
    for name, value in {"name":"My car", "balance":"10000", "tan":"6", "taeg":"8", "monthlyCosts":"5", "start":"01/09/2026", "end":"31/08/2031", "paymentDay":"30"}.items():
        loan.locator(f'[name="{name}"]').fill(value)
    loan.get_by_role("button", name="Save loan").click()
    expect(page.locator("#loan-dialog")).not_to_be_visible()
    expect(page.locator("#loan-result")).to_contain_text("No change")
    def months_saved():
        """The headline reads "2 years 5 months sooner"; compare it in months."""
        text = page.locator("#loan-result .tax-total").inner_text()
        years = re.search(r"(\d+)\s+year", text)
        months = re.search(r"(\d+)\s+month", text)
        return (int(years.group(1)) * 12 if years else 0) + (int(months.group(1)) if months else 0)

    scenario = page.locator("#scenario-form")
    scenario.locator('[name="lump"]').fill("1000")
    once = months_saved()
    assert once > 0
    scenario.locator('[name="mode"]').select_option("recurring")
    expect(page.locator("#lump-field")).not_to_be_visible()
    scenario.locator('[name="recurring"]').fill("100")
    repeat = months_saved()
    scenario.locator('[name="mode"]').select_option("both")
    both = months_saved()
    assert both > repeat and both > once
    expect(page.locator("#scenario-error")).to_be_empty()
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).loans[0].balance") == 1000000
    page.locator('#loans summary').filter(has_text="Monthly repayment schedule").click()
    with page.expect_download() as schedule_download:
        page.locator("#export-loan").click()
    assert "Extra principal EUR" in Path(schedule_download.value.path()).read_text()
    page.locator('#loans summary').filter(has_text="Monthly repayment schedule").click()
    page.screenshot(path="/tmp/conta-loans.png", full_page=True)

    page.locator("#add-loan").click()
    home = page.locator("#loan-form")
    expect(page.locator("#loan-index-fields")).to_be_visible()
    for name, value in {"name": "My home", "balance": "120000", "indexRate": "2.104", "spread": "0.9",
                        "start": "01/10/2026", "end": "30/09/2046", "paymentDay": "8"}.items():
        home.locator(f'[name="{name}"]').fill(value)
    expect(home.locator('[name="tan"]')).to_have_value("3.004")
    assert home.locator('[name="tan"]').evaluate("el => el.readOnly") is True
    home.locator('[name="rateType"]').select_option("fixed")
    expect(page.locator("#loan-index-fields")).not_to_be_visible()
    assert home.locator('[name="tan"]').evaluate("el => el.readOnly") is False
    home.locator('[name="rateType"]').select_option("variable")
    home.get_by_role("button", name="Save loan").click()
    expect(page.locator("#loan-dialog")).not_to_be_visible()
    expect(page.locator("#loan-cards")).to_contain_text("spread")
    expect(page.locator("#loan-cards")).to_contain_text("20 years · 240 payments")
    expect(page.locator("#loan-terms")).to_contain_text("20 years from")
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).loans.find(l => l.name === 'My home').tan") == 3.004
    # Remove it again so the rest of the suite sees the single-loan workspace it expects.
    page.locator("#loan-cards article").filter(has_text="My home").locator("[data-loan-delete]").click()
    expect(page.locator("#loan-cards article")).to_have_count(1)
    page.locator("#selected-loan").select_option(label="My car")
    scenario.locator('[name="lump"]').fill("10001")
    expect(page.locator("#scenario-error")).to_contain_text("exceeds")
    expect(page.locator("#export-loan")).to_be_disabled()
    scenario.locator('[name="lump"]').fill("1000")
    scenario.locator('[name="feeRate"]').fill("0")
    expect(page.locator("#scenario-error")).to_be_empty()

    page.locator('nav a[href="#accounts"]').click()
    for name, kind in [("Salary account", "Current"), ("Meal card", "Meal card")]:
        page.locator("#add-account").click()
        account = page.locator("#account-form")
        account.locator('[name="name"]').fill(name)
        account.locator('[name="bank"]').fill("Test bank")
        account.locator('[name="kind"]').select_option(kind)
        account.locator('[name="opening"]').fill("0")
        account.get_by_role("button", name="Save account").click()
    page.locator('nav a[href="#tax"]').click()
    payroll = page.locator("#payroll-form")
    payroll.locator('[name="gross"]').fill("1300")
    payroll.locator('[name="bankAccountId"]').select_option(label="Salary account")
    payroll.locator('[name="mealAccountId"]').select_option(label="Meal card")
    payroll.locator('[name="youth"]').check()
    payroll.locator('[name="age"]').fill("24")
    payroll.locator('[name="eligible"]').check()
    payroll.locator('[name="employerApplied"]').check()
    payroll.get_by_role("button", name="Calculate take-home pay").click()
    page.locator('nav a[href="#planning"]').click()
    expect(page.locator("#forecast-results tr")).to_have_count(4)
    # The plan keeps its own monthly gross, so pull the new salary through it.
    page.locator("#reset-forecast").click()
    expect(page.locator("#forecast-results tr").first).to_contain_text("157,00")
    page.locator("#forecast-payday").fill("1")
    page.locator('#forecast-inputs [data-month="2026-10"] [data-field="gross"]').fill("1400")
    page.locator("#forecast-form").get_by_role("button", name="Save salary plan").click()
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).forecast.rows[1].gross") == 140000
    expect(page.locator("#forecast-error")).to_be_empty()
    page.locator('nav a[href="#transactions"]').click()
    expect(page.locator("#transaction-rows")).to_contain_text("Salary")
    expect(page.locator("#transaction-rows")).to_contain_text("Scheduled")
    page.locator('nav a[href="#planning"]').click()
    page.locator("#next-payday").get_by_role("button", name="Record salary").click()
    expect(page.locator("#next-payday")).to_contain_text("Recorded")
    saved_salary = page.evaluate("JSON.parse(localStorage.getItem('conta-v1'))")
    assert [(t["salaryPart"], t["accountId"]) for t in saved_salary["transactions"]] == [("bank", saved_salary["payroll"]["bankAccountId"]), ("meal", saved_salary["payroll"]["mealAccountId"])]
    # The overview shows the current month, which moves through the Sep–Dec plan as the year goes on.
    salary = page.locator("#forecast-results tr").nth(date.today().month - 9).locator("td").first.inner_text()
    page.locator('nav a[href="#overview"]').click()
    expect(page.locator("#overview-expected")).to_contain_text("Salary to bank")
    expect(page.locator("#overview-expected")).to_contain_text(salary)
    expect(page.locator("#recent-list")).to_contain_text("Salary")
    expect(page.locator("#recent-list")).to_contain_text("Meal allowance")
    expect(page.locator("#overview-expected-note")).to_contain_text(re.compile(r"Expected salary on \d{2}/\d{2}/\d{4}"))
    page.locator('nav a[href="#planning"]').click()
    page.locator("#add-recurring").click()
    recurring = page.locator("#recurring-form")
    recurring.locator('[name="description"]').fill("Rent")
    recurring.locator('[name="amount"]').fill("500")
    recurring.locator('[name="category"]').select_option("Housing")
    recurring.get_by_role("button", name="Save monthly expense").click()
    expect(page.locator("#recurring-dialog")).not_to_be_visible()
    expect(page.locator("#recurring-list")).to_contain_text("Rent")
    page.locator("#post-recurring").click()
    posted = page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).transactions")
    # Salary parts, one rent, plus whichever loan instalments the calendar has already made due.
    assert sum(t["description"] == "Rent" for t in posted) == 1 and len(posted) >= 3, [(t["description"], t["date"]) for t in posted]
    expect(page.locator("#post-recurring")).to_be_disabled()
    page.reload()
    expect(page.locator("#post-recurring")).to_be_disabled()
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).forecast.rows[1].gross") == 140000
    page.locator("#recurring-list").get_by_role("button", name="Pause", exact=True).click()
    expect(page.locator("#recurring-list")).to_contain_text("Paused")
    page.locator("#recurring-list").get_by_role("button", name="Resume", exact=True).click()
    expect(page.locator("#post-recurring")).to_be_disabled()

    # An ordinary transaction can create a monthly rule without duplicating its first expense.
    page.locator('nav a[href="#transactions"]').click()
    page.locator("#transactions .add-transaction").click()
    transaction = page.locator("#transaction-form")
    transaction.locator('[name="description"]').fill("Monthly pass")
    transaction.locator('[name="amount"]').fill("40")
    transaction.locator('[name="repeat"]').check()
    transaction.get_by_role("button", name="Save transaction").click()
    expect(page.locator("#transaction-dialog")).not_to_be_visible()
    assert len(page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).recurring")) == 2
    page.get_by_role("button", name="Edit Monthly pass", exact=True).click()
    transaction.locator('[name="amount"]').fill("45")
    transaction.get_by_role("button", name="Save transaction").click()
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).transactions.find(t=>t.description==='Monthly pass').recurringId")
    page.locator('nav a[href="#planning"]').click()
    expect(page.locator("#post-recurring")).to_be_disabled()
    page.screenshot(path="/tmp/conta-planning.png", full_page=True)

    for target in ["planning", "loans"]:
        page.locator(f'nav a[href="#{target}"]').click()
        page.set_viewport_size({"width": 320, "height": 700})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), target
        page.screenshot(path=f"/tmp/conta-{target}-mobile.png", full_page=True)
        page.set_viewport_size({"width": 1440, "height": 1050})
    page.locator('nav a[href="#settings"]').click()
    with page.expect_download() as planning_backup:
        page.locator("#backup").click()
    backup = Path(planning_backup.value.path()).read_bytes()
    assert json.loads(backup)["version"] == 5
    page.locator("#clear-data").click()
    page.locator("#restore").set_input_files({"name": "planning.json", "mimeType": "application/json", "buffer": backup})
    for _ in range(100):
        saved = page.evaluate("JSON.parse(localStorage.getItem('conta-v1'))")
        if saved["loans"]:
            break
        page.wait_for_timeout(100)
    assert len(saved["loans"]) == 1 and len(saved["recurring"]) == 2 and len(saved["transactions"]) == len(posted) + 1
    assert saved["forecast"]["rows"][1]["gross"] == 140000
    assert not errors, errors

    # Integrated cash, loan payments and the user's insurance PPR, in isolated storage.
    fresh_workspace()
    context = browser.new_context(reduced_motion="reduce", viewport={"width": 1440, "height": 1050})
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("dialog", lambda dialog: dialog.accept())
    page.goto(BASE, wait_until="load")
    page.locator("#start-fresh").click()
    page.locator('nav a[href="#accounts"]').click()
    page.locator("#add-account").click()
    account = page.locator("#account-form")
    for name, value in {"name":"Spending", "bank":"Test bank", "opening":"1000"}.items():
        account.locator(f'[name="{name}"]').fill(value)
    account.get_by_role("button", name="Save account").click()
    page.locator('nav a[href="#portfolio"]').click()
    page.locator("#add-ppr").click()
    holding = page.locator("#holding-form")
    expect(holding.locator('[name="name"]')).to_be_empty()
    expect(holding.locator('[name="kind"]')).to_have_value("PPR / Insurance")
    expect(page.locator("#holding-units-label")).to_be_hidden()
    assert not holding.locator('[name="symbol"]').evaluate("e => e.required")
    assert holding.locator('[name="broker"]').get_attribute("list") == "financial-providers"
    holding.locator('[name="name"]').fill("Test PPR")
    holding.locator('[name="broker"]').fill("Test provider")
    holding.locator('[name="price"]').fill("100")
    holding.locator('[name="cost"]').fill("100")
    holding.get_by_role("button", name="Save investment").click()
    expect(page.locator("#holding-dialog")).to_be_hidden()
    page.locator("#add-investment-plan").click()
    plan = page.locator("#investment-plan-form")
    plan.locator('[name="accountId"]').select_option(label="Spending")
    for name, value in {"amount":"50", "start":"01/09/2026", "end":"31/08/2027", "day":"1", "initialValue":"100", "annualRate":"5"}.items():
        plan.locator(f'[name="{name}"]').fill(value)
    plan.get_by_role("button", name="Save contribution plan").click()
    expect(page.locator("#investment-plan-dialog")).to_be_hidden()
    expect(page.locator("#investment-projection")).to_contain_text("Projected end value")
    page.locator('nav a[href="#planning"]').click()
    # One 50 EUR contribution per month since September is reserved until recorded.
    expect(page.locator("#planning-cash")).to_contain_text(f"{1000 - 50 * (date.today().month - 8)},00")
    expect(page.locator("#payment-list")).to_contain_text("Test PPR")
    page.locator('nav a[href="#loans"]').click()
    page.locator("#add-loan").click()
    loan = page.locator("#loan-form")
    for name, value in {"name":"Small loan", "balance":"120", "tan":"0", "start":"01/09/2026", "end":"31/08/2027", "paymentDay":"1"}.items():
        loan.locator(f'[name="{name}"]').fill(value)
    loan.locator('[name="accountId"]').select_option(label="Spending")
    expect(page.locator("#loan-date-summary")).to_contain_text("12 payments")
    loan.get_by_role("button", name="Save loan").click()
    expect(page.locator("#loan-dialog")).to_be_hidden()
    page.locator('nav a[href="#planning"]').click()
    page.locator("#add-recurring").click()
    recurring = page.locator("#recurring-form")
    for name, value in {"description":"Internet", "amount":"100", "start":"01/09/2026", "day":"1"}.items():
        recurring.locator(f'[name="{name}"]').fill(value)
    recurring.locator('[name="accountId"]').select_option(label="Spending")
    recurring.get_by_role("button", name="Save monthly expense").click()
    # Everything below starts in September 2026, so the calendar decides how many months are due.
    due = date.today().month - 8
    expect(page.locator("#planning-cash")).to_contain_text(f"Available cash{1000 - 160 * due},00")
    page.locator('nav a[href="#overview"]').click()
    expect(page.locator("#overview-expected-movements")).to_contain_text("Small loan")
    expect(page.locator("#overview-expected-movements")).to_contain_text("Scheduled loan payment")
    page.locator('nav a[href="#transactions"]').click()
    expect(page.locator("#transaction-rows")).to_contain_text("Small loan")
    expect(page.locator("#transaction-rows")).to_contain_text("Scheduled")
    page.locator('nav a[href="#planning"]').click()
    page.locator('[data-payment-kind="loan"]').first.click()
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).transactions.filter(t=>t.loanId).length") == 1
    page.locator('nav a[href="#overview"]').click()
    page.locator("#overview-month").fill("09/2026")
    page.locator("#overview-month").dispatch_event("change")
    expect(page.locator("#recent-list")).to_contain_text("Small loan")
    page.locator('nav a[href="#planning"]').click()
    expect(page.locator("#planning-cash")).to_contain_text("Recorded cash990,00")
    expect(page.locator("#planning-cash")).to_contain_text(f"Available cash{1000 - 160 * due},00")
    page.locator("#post-recurring").click()
    expect(page.locator("#post-recurring")).to_be_disabled()
    expect(page.locator("#planning-cash")).to_contain_text(f"Recorded cash{1000 - 110 * due},00")
    contribution = page.locator("#contribution-form")
    for _ in range(due):
        page.locator('[data-payment-kind="investment"]').first.click()
        expect(page.locator("#contribution-units-label")).to_be_hidden()
        contribution.locator('[name="price"]').fill("150")
        contribution.get_by_role("button", name="Save contribution").click()
        expect(page.locator("#contribution-dialog")).to_be_hidden()
    expect(page.locator("#planning-cash")).to_contain_text(f"Available cash{1000 - 160 * due},00")
    expect(page.locator("#payment-list")).to_contain_text("No unpaid commitments")
    saved = page.evaluate("JSON.parse(localStorage.getItem('conta-v1'))")
    assert len(saved["contributions"]) == due and saved["holdings"][0]["cost"] == 10000 + 5000 * due
    assert len(saved["transactions"]) == 2 * due
    page.reload()
    expect(page.locator("#payment-list")).to_contain_text("No unpaid commitments")
    expect(page.locator("#post-recurring")).to_be_disabled()
    # Dates and payday persist and drive the salary rows.
    page.locator("#forecast-start").fill("01/09/2026")
    page.locator("#forecast-end").fill("31/10/2026")
    page.locator("#forecast-payday").fill("28")
    page.locator("#forecast-form").get_by_role("button", name="Save salary plan").click()
    expect(page.locator("#forecast-results tr")).to_have_count(2)
    expect(page.locator("#forecast-results tr").first).to_contain_text("28/09/2026")
    page.locator('nav a[href="#portfolio"]').click()
    expect(page.locator("#investment-projection")).to_contain_text("Recorded contributions through that date")
    page.locator("#investment-projection").get_by_role("button", name="Update actual value").click()
    holding.locator('[name="price"]').fill("155")
    holding.get_by_role("button", name="Save investment").click()
    expect(page.locator("#portfolio-gain")).to_contain_text("5,00")
    expect(page.locator("#investment-projection")).to_contain_text("155,00")
    # Unit-based holdings use actual purchased shares; undo restores cash and units.
    page.locator("#add-holding").click()
    for name, value in {"name":"Test shares", "broker":"Broker", "units":"0", "price":"100", "cost":"0"}.items():
        holding.locator(f'[name="{name}"]').fill(value)
    holding.get_by_role("button", name="Save investment").click()
    page.locator("#add-contribution").click()
    contribution.locator('[name="holdingId"]').select_option(label="Test shares")
    contribution.locator('[name="accountId"]').select_option(label="Spending")
    contribution.locator('[name="amount"]').fill("50")
    contribution.locator('[name="units"]').fill("0.5")
    contribution.get_by_role("button", name="Save contribution").click()
    expect(page.locator("#contribution-dialog")).to_be_hidden()
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).holdings.find(h=>h.name==='Test shares').units") == 0.5
    page.locator('#portfolio summary').filter(has_text="Recorded investment contributions").click()
    page.locator("#contribution-rows tr").filter(has_text="Test shares").get_by_role("button", name="Undo").click()
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).holdings.find(h=>h.name==='Test shares').units") == 0
    page.screenshot(path="/tmp/conta-investments.png", full_page=True)
    page.set_viewport_size({"width":320,"height":700})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.screenshot(path="/tmp/conta-investments-mobile.png", full_page=True)
    page.locator("#add-investment-plan").click()
    page.screenshot(path="/tmp/conta-investment-dialog-mobile.png", full_page=True)
    assert page.locator("#investment-plan-dialog").evaluate("e => e.scrollWidth <= e.clientWidth")
    plan.get_by_role("button", name="Cancel").click()
    page.set_viewport_size({"width":1440,"height":1050})
    page.locator('nav a[href="#settings"]').click()
    with page.expect_download() as investment_backup:
        page.locator("#backup").click()
    backup = Path(investment_backup.value.path()).read_bytes()
    page.locator("#clear-data").click()
    page.locator("#restore").set_input_files({"name":"investments.json","mimeType":"application/json","buffer":backup})
    for _ in range(100):
        restored = page.evaluate("JSON.parse(localStorage.getItem('conta-v1'))")
        if restored["investmentPlans"]:
            break
        page.wait_for_timeout(100)
    assert len(restored["investmentPlans"]) == 1 and len(restored["contributions"]) == due
    assert restored["forecast"]["payDay"] == 28
    # A later year must reach the inputs too, not only the validators.
    page.locator('nav a[href="#tax"]').click()
    payroll = page.locator("#payroll-form")
    payroll.locator('[name="month"]').fill("03/2027")
    payroll.get_by_role("button", name="Calculate take-home pay").click()
    expect(page.locator("#payroll-result")).to_contain_text("2026 tables applied to 2027")
    page.locator('nav a[href="#planning"]').click()
    page.locator("#reset-forecast").click()
    expect(page.locator("#forecast-heading")).to_have_text("Your salary plan · 2027")
    expect(page.locator("#forecast-start")).to_have_value("01/03/2027")
    expect(page.locator("#forecast-results tr")).to_have_count(10)
    expect(page.locator("#forecast-error")).to_be_empty()
    page.locator("#forecast-end").fill("29/02/2028")
    page.locator("#forecast-form").get_by_role("button", name="Save salary plan").click()
    expect(page.locator("#forecast-error")).to_contain_text("one calendar year")
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).forecast.end") == "2027-12-31"

    # Source-only files remain inaccessible from the local app server.
    for private_path in ["/.env", "/README.md", "/GITHUB.md", "/start.py"]:
        assert page.request.get(BASE + private_path).status == 404
    assert not errors, errors

    browser.close()
    print("PASS: desktop/mobile, transactions, accounts, transfers, portfolio, snapshots, salary/IRS Jovem/meals/12-14 comparison, persistence, exports, backups, failed-save protection, loan overpayments, monthly expenses, salary dates/paydays, cash reservations, PPR/stock contributions, projections and investment backup/restore.")
