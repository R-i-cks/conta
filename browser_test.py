"""Optional end-to-end checks: run server first, then uv run --with playwright python browser_test.py."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(reduced_motion="reduce", viewport={"width": 1440, "height": 1100})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("dialog", lambda dialog: dialog.accept())
    page.goto("http://127.0.0.1:4173", wait_until="networkidle")
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

    def add(description, amount, kind, category):
        page.locator("#overview .add-transaction").click()
        form = page.locator("#transaction-form")
        form.locator('[name="description"]').fill(description)
        form.locator('[name="amount"]').fill(amount)
        form.locator('[name="type"]').select_option(kind)
        form.locator('[name="category"]').select_option(category)
        form.get_by_role("button", name="Save transaction").click()
        expect(page.locator("#transaction-dialog")).not_to_be_visible()

    add("Salary test", "2500.29", "income", "Salary")
    add('<img src=x onerror="alert(1)">', "100.01", "expense", "Groceries")
    assert page.locator("#recent-list img").count() == 0
    expect(page.locator("#balance")).to_contain_text("400,28")
    expect(page.locator("#spending .ring-center strong")).to_contain_text("100,01")
    expect(page.locator("#spending .spending-row")).to_have_count(1)
    expect(page.locator("#spending .spending-row")).to_contain_text("Groceries")
    expect(page.locator("#assets")).to_contain_text("0,00")
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
    page.locator("#tax-form").get_by_role("button").click()
    expect(page.locator("#tax-result")).to_contain_text("500,00")
    expect(page.locator("#bracket-rows tr.current")).to_contain_text("09")
    page.locator("#taxation").select_option("joint")
    page.locator("#taxable-income").fill("200000")
    page.locator("#tax-form").get_by_role("button").click()
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
    expect(page.locator("#account-cards .account-card")).to_have_count(2)
    page.locator("#add-transfer").click()
    page.locator('#transfer-form [name="amount"]').fill("200")
    page.locator("#transfer-form").get_by_role("button", name="Save transfer").click()
    expect(page.locator("#transfer-rows tr")).to_have_count(1)
    expect(page.locator("#total-cash")).to_contain_text("500,00")
    page.locator('nav a[href="#transactions"]').click()
    page.get_by_role("button", name="Edit Salary test", exact=True).click()
    page.locator("#transaction-account").select_option(label="Everyday")
    page.locator("#transaction-form").get_by_role("button", name="Save transaction").click()
    page.locator('nav a[href="#accounts"]').click()
    expect(page.locator("#total-cash")).to_contain_text("500,29")

    page.locator('nav a[href="#portfolio"]').click()
    page.locator("#add-holding").click()
    holding = page.locator("#holding-form")
    for name, value in {"name":"Test ETF", "symbol":"TEST", "broker":"Broker", "units":"2.5", "price":"120", "cost":"250"}.items():
        holding.locator(f'[name="{name}"]').fill(value)
    holding.get_by_role("button", name="Save investment").click()
    expect(page.locator("#portfolio-value")).to_contain_text("300,00")
    expect(page.locator("#portfolio-gain")).to_contain_text("50,00")
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

    # The requested salary profile: age 24, first eligible year, meal card.
    page.locator('nav a[href="#tax"]').click()
    payroll = page.locator("#payroll-form")
    payroll.locator('[name="gross"]').fill("1300")
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
    page.screenshot(path="/tmp/conta-payroll.png", full_page=True)
    page.set_viewport_size({"width": 320, "height": 700})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.set_viewport_size({"width": 1440, "height": 1100})

    page.locator('nav a[href="#settings"]').click()
    with page.expect_download() as download_info:
        page.locator("#backup").click()
    backup = Path(download_info.value.path()).read_bytes()
    assert len(json.loads(backup)["transactions"]) == 2
    assert len(json.loads(backup)["accounts"]) == 2
    assert len(json.loads(backup)["holdings"]) == 1
    page.locator("#clear-data").click()
    page.locator("#restore").set_input_files({"name": "backup.json", "mimeType": "application/json", "buffer": backup})
    expect(page.locator("#toast")).to_contain_text("Your workspace is ready")
    assert len(page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).transactions")) == 2
    assert len(page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).holdings")) == 1
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).payroll.payments") == 12
    page.locator("#restore").set_input_files({"name": "bad.json", "mimeType": "application/json", "buffer": b'{"version": 1}'})
    expect(page.locator("#toast")).to_contain_text("Could not import")
    assert len(page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).transactions")) == 2

    page.locator('nav a[href="#transactions"]').click()
    page.get_by_role("button", name="Delete Salary test", exact=True).click()
    expect(page.locator("#transaction-rows tr")).to_have_count(1)
    page.reload()
    expect(page.locator("#transaction-rows tr")).to_have_count(1)
    page.set_viewport_size({"width": 320, "height": 700})
    page.screenshot(path="/tmp/conta-narrow.png", full_page=True)
    if page.evaluate("document.documentElement.scrollWidth > innerWidth"):
        print(page.evaluate("Array.from(document.querySelectorAll('body *')).filter(e=>e.getBoundingClientRect().right>innerWidth && e.getBoundingClientRect().width).map(e=>[e.tagName,e.id,e.className,e.getBoundingClientRect().right]).slice(0,30)"))
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")

    page.evaluate("() => { Storage.prototype.setItem = function() { throw new Error('Quota exceeded'); }; }")
    page.locator('nav a[href="#overview"]').click()
    page.locator("#overview .add-transaction").click()
    page.locator('#transaction-form [name="description"]').fill("Must not save")
    page.locator('#transaction-form [name="amount"]').fill("1")
    page.locator("#transaction-form").get_by_role("button", name="Save transaction").click()
    expect(page.locator("#toast")).to_contain_text("Could not save")
    expect(page.locator("#transaction-dialog")).to_be_visible()
    assert len(page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).transactions")) == 1
    assert not errors, errors
    # Fresh storage for planning and loan scenarios.
    context = browser.new_context(reduced_motion="reduce", viewport={"width": 1440, "height": 1050})
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("dialog", lambda dialog: dialog.accept())
    page.goto("http://127.0.0.1:4173", wait_until="networkidle")
    page.locator("#start-fresh").click()
    page.locator('nav a[href="#loans"]').click()
    page.locator("#add-loan").click()
    loan = page.locator("#loan-form")
    loan.locator('[name="kind"]').select_option("car")
    expect(loan.locator('[name="interestTax"]')).to_have_value("4")
    loan.locator('[name="rateType"]').select_option("fixed")
    for name, value in {"name":"My car", "balance":"10000", "tan":"6", "taeg":"8", "monthlyCosts":"5", "start":"2026-09-01", "end":"2031-08-31", "paymentDay":"30"}.items():
        loan.locator(f'[name="{name}"]').fill(value)
    loan.get_by_role("button", name="Save loan").click()
    expect(page.locator("#loan-dialog")).not_to_be_visible()
    expect(page.locator("#loan-result")).to_contain_text("0 months sooner")
    scenario = page.locator("#scenario-form")
    scenario.locator('[name="lump"]').fill("1000")
    once = page.locator("#loan-result .tax-total").inner_text()
    assert int(once.split()[0]) > 0
    scenario.locator('[name="mode"]').select_option("recurring")
    expect(page.locator("#lump-field")).not_to_be_visible()
    scenario.locator('[name="recurring"]').fill("100")
    repeat = int(page.locator("#loan-result .tax-total").inner_text().split()[0])
    scenario.locator('[name="mode"]').select_option("both")
    both = int(page.locator("#loan-result .tax-total").inner_text().split()[0])
    assert both > repeat and both > int(once.split()[0])
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
                        "start": "2026-10-01", "end": "2046-09-30", "paymentDay": "8"}.items():
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

    page.locator('nav a[href="#tax"]').click()
    payroll = page.locator("#payroll-form")
    payroll.locator('[name="gross"]').fill("1300")
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
    page.locator('#forecast-inputs [data-month="2026-10"] [data-field="gross"]').fill("1400")
    page.locator("#forecast-form").get_by_role("button", name="Save salary plan").click()
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).forecast.rows[1].gross") == 140000
    expect(page.locator("#forecast-error")).to_be_empty()
    page.locator("#add-recurring").click()
    recurring = page.locator("#recurring-form")
    recurring.locator('[name="description"]').fill("Rent")
    recurring.locator('[name="amount"]').fill("500")
    recurring.locator('[name="category"]').select_option("Housing")
    recurring.get_by_role("button", name="Save monthly expense").click()
    expect(page.locator("#recurring-dialog")).not_to_be_visible()
    expect(page.locator("#recurring-list")).to_contain_text("Rent")
    page.locator("#post-recurring").click()
    assert len(page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).transactions")) == 1
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
    assert json.loads(backup)["version"] == 4
    page.locator("#clear-data").click()
    page.locator("#restore").set_input_files({"name": "planning.json", "mimeType": "application/json", "buffer": backup})
    saved = page.evaluate("JSON.parse(localStorage.getItem('conta-v1'))")
    assert len(saved["loans"]) == 1 and len(saved["recurring"]) == 2 and len(saved["transactions"]) == 2
    assert saved["forecast"]["rows"][1]["gross"] == 140000
    assert not errors, errors

    # Integrated cash, loan payments and the user's insurance PPR, in isolated storage.
    context = browser.new_context(reduced_motion="reduce", viewport={"width": 1440, "height": 1050})
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("dialog", lambda dialog: dialog.accept())
    page.goto("http://127.0.0.1:4173", wait_until="networkidle")
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
    expect(holding.locator('[name="name"]')).to_have_value("Seguro PPR+ Ações")
    expect(holding.locator('[name="kind"]')).to_have_value("PPR / Insurance")
    expect(page.locator("#holding-units-label")).to_be_hidden()
    assert not holding.locator('[name="symbol"]').evaluate("e => e.required")
    holding.locator('[name="price"]').fill("100")
    holding.locator('[name="cost"]').fill("100")
    holding.get_by_role("button", name="Save investment").click()
    expect(page.locator("#holding-dialog")).to_be_hidden()
    page.locator("#add-investment-plan").click()
    plan = page.locator("#investment-plan-form")
    plan.locator('[name="accountId"]').select_option(label="Spending")
    for name, value in {"amount":"50", "start":"2026-09-01", "end":"2027-08-31", "day":"1", "initialValue":"100", "annualRate":"5"}.items():
        plan.locator(f'[name="{name}"]').fill(value)
    plan.get_by_role("button", name="Save contribution plan").click()
    expect(page.locator("#investment-plan-dialog")).to_be_hidden()
    expect(page.locator("#investment-projection")).to_contain_text("Projected end value")
    page.locator('nav a[href="#planning"]').click()
    expect(page.locator("#planning-cash")).to_contain_text("950,00")
    expect(page.locator("#payment-list")).to_contain_text("Seguro PPR+ Ações")
    page.locator('nav a[href="#loans"]').click()
    page.locator("#add-loan").click()
    loan = page.locator("#loan-form")
    for name, value in {"name":"Small loan", "balance":"120", "tan":"0", "start":"2026-09-01", "end":"2027-08-31", "paymentDay":"1"}.items():
        loan.locator(f'[name="{name}"]').fill(value)
    loan.locator('[name="accountId"]').select_option(label="Spending")
    expect(page.locator("#loan-date-summary")).to_contain_text("12 payments")
    loan.get_by_role("button", name="Save loan").click()
    expect(page.locator("#loan-dialog")).to_be_hidden()
    page.locator('nav a[href="#planning"]').click()
    page.locator("#add-recurring").click()
    recurring = page.locator("#recurring-form")
    for name, value in {"description":"Internet", "amount":"100", "start":"2026-09-01", "day":"1"}.items():
        recurring.locator(f'[name="{name}"]').fill(value)
    recurring.locator('[name="accountId"]').select_option(label="Spending")
    recurring.get_by_role("button", name="Save monthly expense").click()
    expect(page.locator("#planning-cash")).to_contain_text("840,00")
    page.locator('[data-payment-kind="loan"]').click()
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).transactions.filter(t=>t.loanId).length") == 1
    expect(page.locator("#planning-cash")).to_contain_text("990,00")
    expect(page.locator("#planning-cash")).to_contain_text("840,00")
    page.locator("#post-recurring").click()
    expect(page.locator("#post-recurring")).to_be_disabled()
    expect(page.locator("#planning-cash")).to_contain_text("890,00")
    page.locator('[data-payment-kind="investment"]').click()
    contribution = page.locator("#contribution-form")
    expect(page.locator("#contribution-units-label")).to_be_hidden()
    contribution.locator('[name="price"]').fill("150")
    contribution.get_by_role("button", name="Save contribution").click()
    expect(page.locator("#contribution-dialog")).to_be_hidden()
    expect(page.locator("#planning-cash")).to_contain_text("840,00")
    expect(page.locator("#payment-list")).to_contain_text("No unpaid commitments")
    saved = page.evaluate("JSON.parse(localStorage.getItem('conta-v1'))")
    assert len(saved["contributions"]) == 1 and saved["holdings"][0]["cost"] == 15000
    assert len(saved["transactions"]) == 2
    page.reload()
    expect(page.locator("#payment-list")).to_contain_text("No unpaid commitments")
    expect(page.locator("#post-recurring")).to_be_disabled()
    # Dates and payday persist and drive the salary rows.
    page.locator("#forecast-start").fill("2026-09-01")
    page.locator("#forecast-end").fill("2026-10-31")
    page.locator("#forecast-payday").fill("28")
    page.locator("#forecast-form").get_by_role("button", name="Save salary plan").click()
    expect(page.locator("#forecast-results tr")).to_have_count(2)
    expect(page.locator("#forecast-results tr").first).to_contain_text("28 Sept 2026")
    page.locator('nav a[href="#portfolio"]').click()
    expect(page.locator("#investment-projection")).to_contain_text("Recorded contributions since plan start")
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
    restored = page.evaluate("JSON.parse(localStorage.getItem('conta-v1'))")
    assert len(restored["investmentPlans"]) == 1 and len(restored["contributions"]) == 1
    assert restored["forecast"]["payDay"] == 28
    # A later year must reach the inputs too, not only the validators.
    page.locator('nav a[href="#tax"]').click()
    payroll = page.locator("#payroll-form")
    payroll.locator('[name="month"]').fill("2027-03")
    payroll.get_by_role("button", name="Calculate take-home pay").click()
    expect(page.locator("#payroll-result")).to_contain_text("2026 tables applied to 2027")
    page.locator('nav a[href="#planning"]').click()
    page.locator("#reset-forecast").click()
    expect(page.locator("#forecast-heading")).to_have_text("Your salary plan · 2027")
    expect(page.locator("#forecast-start")).to_have_value("2027-03-01")
    expect(page.locator("#forecast-results tr")).to_have_count(10)
    expect(page.locator("#forecast-error")).to_be_empty()
    page.locator("#forecast-end").fill("2028-02-29")
    page.locator("#forecast-form").get_by_role("button", name="Save salary plan").click()
    expect(page.locator("#forecast-error")).to_contain_text("one calendar year")
    assert page.evaluate("JSON.parse(localStorage.getItem('conta-v1')).forecast.end") == "2027-12-31"

    # Source-only files remain inaccessible from the local app server.
    for private_path in ["/.env", "/README.md", "/GITHUB.md", "/start.py"]:
        assert page.request.get("http://127.0.0.1:4173" + private_path).status == 404
    assert not errors, errors

    browser.close()
    print("PASS: desktop/mobile, transactions, accounts, transfers, portfolio, snapshots, salary/IRS Jovem/meals/12-14 comparison, persistence, exports, backups, failed-save protection, loan overpayments, monthly expenses, salary dates/paydays, cash reservations, PPR/stock contributions, projections and investment backup/restore.")
