import org.junit.jupiter.api.*;
import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.*;

import java.time.Duration;

class TransferE2ETest {
    private WebDriver driver;
    private WebDriverWait wait;

    @BeforeEach
    void setUp() {
        System.setProperty("webdriver.chrome.driver", "path/to/chromedriver");
        driver = new ChromeDriver();
        wait = new WebDriverWait(driver, Duration.ofSeconds(10));
        driver.get(System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:8080");
    }

    @AfterEach
    void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }

    @Test
    void testSuccessfulTransfer() {
        login("customer01", "pass123", "customer");
        clickTab("振込");

        WebElement toField = driver.findElement(By.id("transferTo"));
        WebElement amountField = driver.findElement(By.id("transferAmount"));
        WebElement memoField = driver.findElement(By.id("transferMemo"));
        WebElement submitBtn = driver.findElement(By.cssSelector("button[type='submit']"));

        toField.sendKeys("9876543210");
        amountField.sendKeys("50000");
        memoField.sendKeys("Test transfer");
        submitBtn.click();

        wait.until(ExpectedConditions.textToBePresentInElement(
            driver.findElement(By.id("transferMessage")),
            "✅ 振込が完了しました"
        ));

        String balanceText = driver.findElement(By.id("balance")).getText();
        Assertions.assertTrue(balanceText.contains("¥1,450,000"), "残高が正しく更新されていません");

        WebElement transactions = driver.findElement(By.id("transactionList"));
        wait.until(ExpectedConditions.textToBePresentInElement(transactions, "Test transfer"));
    }

    @Test
    void testTransferValidationErrors() {
        login("customer01", "pass123", "customer");
        clickTab("振込");

        WebElement toField = driver.findElement(By.id("transferTo"));
        WebElement amountField = driver.findElement(By.id("transferAmount"));
        WebElement submitBtn = driver.findElement(By.cssSelector("button[type='submit']"));

        // 口座番号形式エラー
        toField.sendKeys("12345");
        amountField.sendKeys("1000");
        submitBtn.click();

        WebElement errorMsg = wait.until(ExpectedConditions.visibilityOfElementLocated(
            By.xpath("//div[contains(text(), '振込先口座番号は10桁の数字で入力してください')]")
        ));
        Assertions.assertNotNull(errorMsg);

        // 金額上限超過
        toField.clear();
        toField.sendKeys("9876543210");
        amountField.clear();
        amountField.sendKeys("1000001");
        submitBtn.click();

        errorMsg = wait.until(ExpectedConditions.visibilityOfElementLocated(
            By.xpath("//div[contains(text(), '1回の振込上限（¥1,000,000）を超えています')]")
        ));
        Assertions.assertNotNull(errorMsg);
    }

    @Test
    void testHighAmountTransferRequiresApproval() {
        login("customer01", "pass123", "customer");
        clickTab("振込");

        WebElement toField = driver.findElement(By.id("transferTo"));
        WebElement amountField = driver.findElement(By.id("transferAmount"));
        WebElement submitBtn = driver.findElement(By.cssSelector("button[type='submit']"));

        toField.sendKeys("9876543210");
        amountField.sendKeys("100000");
        submitBtn.click();

        WebElement warningMsg = wait.until(ExpectedConditions.textToBePresentInElement(
            driver.findElement(By.id("transferMessage")),
            "¥100,000以上の振込は管理者承認が必要です"
        ));
        Assertions.assertTrue(warningMsg.isDisplayed(), "承認待ちメッセージが表示されません");
    }

    private void login(String username, String password, String role) {
        driver.findElement(By.id("username")).sendKeys(username);
        driver.findElement(By.id("password")).sendKeys(password);
        driver.findElement(By.id("role")).sendKeys(role);
        driver.findElement(By.cssSelector("button[type='submit']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("mfaScreen")));
        driver.findElement(By.id("mfaCode")).sendKeys("123456");
        driver.findElement(By.cssSelector("button[type='submit']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("dashboard")));
    }

    private void clickTab(String tabName) {
        driver.findElement(By.xpath("//a[contains(text(),'" + tabName + "')]")).click();
        wait.until(ExpectedConditions.urlContains("transfer"));
    }
}
