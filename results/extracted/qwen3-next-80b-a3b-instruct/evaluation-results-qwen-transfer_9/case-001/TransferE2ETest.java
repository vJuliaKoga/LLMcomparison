import org.junit.jupiter.api.*;
import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import java.time.Duration;
import java.util.Objects;

import static org.junit.jupiter.api.Assertions.*;

public class TransferE2ETest {

    private WebDriver driver;
    private WebDriverWait wait;
    private final String baseUrl = Objects.requireNonNullElse(System.getenv("BASE_URL"), "http://localhost:8080");

    @BeforeEach
    void setUp() {
        System.setProperty("webdriver.chrome.driver", "chromedriver");
        driver = new ChromeDriver();
        wait = new WebDriverWait(driver, Duration.ofSeconds(10));
        driver.get(baseUrl);
    }

    @AfterEach
    void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }

    @Test
    void 正常系_100000円未満の振込が成功する() {
        // ログイン（一般顧客）
        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        driver.findElement(By.id("role")).sendKeys("customer");
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("mfaCode")));
        driver.findElement(By.id("mfaCode")).sendKeys("123456");
        driver.findElement(By.xpath("//button[text()='認証']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("tabTransfer")));
        driver.findElement(By.id("tabTransfer")).click();

        // 振込入力（1円）
        driver.findElement(By.id("transferTo")).sendKeys("9876543210");
        driver.findElement(By.id("transferAmount")).sendKeys("1");
        driver.findElement(By.id("transferMemo")).sendKeys("テスト振込");
        driver.findElement(By.xpath("//button[text()='振込実行']")).click();

        // 成功メッセージ表示を確認
        WebElement message = wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("transferMessage")));
        assertEquals("✅ 振込が完了しました", message.getText());

        // 残高更新を確認（元残高1,500,000 - 1 = 1,499,999）
        WebElement balance = wait.until(ExpectedConditions.presenceOfElementLocated(By.id("balance")));
        assertEquals("¥1,499,999", balance.getText());

        // 監査ログにinfoが記録されているか（admin/auditorのみ表示だが、ログイベントは記録される）
        // 本テストではUI表示は確認せず、イベント記録は仕様通りと仮定
    }

    @Test
    void 異常系_自己振込が拒否される() {
        // ログイン（一般顧客）
        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        driver.findElement(By.id("role")).sendKeys("customer");
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("mfaCode")));
        driver.findElement(By.id("mfaCode")).sendKeys("123456");
        driver.findElement(By.xpath("//button[text()='認証']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("tabTransfer")));
        driver.findElement(By.id("tabTransfer")).click();

        // 自分の口座番号を入力
        driver.findElement(By.id("transferTo")).sendKeys("1234567890");
        driver.findElement(By.id("transferAmount")).sendKeys("10000");
        driver.findElement(By.id("transferMemo")).sendKeys("");
        driver.findElement(By.xpath("//button[text()='振込実行']")).click();

        // エラーメッセージ表示を確認
        WebElement error = wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("transferMessage")));
        assertEquals("❌ 自分の口座には振込できません", error.getText());
    }

    @Test
    void 承認フロー_100000円以上で一般顧客は承認待ちになる() {
        // ログイン（一般顧客）
        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        driver.findElement(By.id("role")).sendKeys("customer");
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("mfaCode")));
        driver.findElement(By.id("mfaCode")).sendKeys("123456");
        driver.findElement(By.xpath("//button[text()='認証']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("tabTransfer")));
        driver.findElement(By.id("tabTransfer")).click();

        // 100,000円振込
        driver.findElement(By.id("transferTo")).sendKeys("9876543210");
        driver.findElement(By.id("transferAmount")).sendKeys("100000");
        driver.findElement(By.id("transferMemo")).sendKeys("");
        driver.findElement(By.xpath("//button[text()='振込実行']")).click();

        // 承認待ちメッセージ表示を確認
        WebElement message = wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("transferMessage")));
        assertEquals("⚠️ ¥100,000以上の振込は管理者承認が必要です。承認待ちに追加されました。", message.getText());

        // 残高は変更されていないことを確認
        WebElement balance = driver.findElement(By.id("balance"));
        assertEquals("¥1,500,000", balance.getText());
    }
}
