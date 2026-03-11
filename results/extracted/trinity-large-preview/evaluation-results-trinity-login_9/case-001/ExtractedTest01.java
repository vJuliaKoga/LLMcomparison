import org.junit.jupiter.api.*;
import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.*;

import java.time.Duration;

class SecureBankLoginTest {
    private WebDriver driver;
    private WebDriverWait wait;

    @BeforeEach
    void setUp() {
        System.setProperty("webdriver.chrome.driver", "chromedriver");
        driver = new ChromeDriver();
        wait = new WebDriverWait(driver, Duration.ofSeconds(10));
        driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(5));
    }

    @AfterEach
    void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }

    @Test
    void testLoginSuccessWithMFA() {
        driver.get(System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:8080");

        // 基本認証
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("loginScreen")));
        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        driver.findElement(By.id("role")).sendKeys("一般顧客");
        driver.findElement(By.cssSelector("button[type='submit']")).click();

        // MFA画面待機
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("mfaScreen")));
        driver.findElement(By.id("mfaCode")).sendKeys("123456");
        driver.findElement(By.cssSelector("button[type='submit']")).click();

        // ダッシュボード表示確認
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("dashboard")));
        Assertions.assertTrue(driver.findElement(By.id("userInfo")).isDisplayed());
    }

    @Test
    void testLoginFailureWithLockout() {
        driver.get(System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:8080");

        // 3回連続失敗
        for (int i = 0; i < 3; i++) {
            driver.findElement(By.id("username")).clear();
            driver.findElement(By.id("password")).clear();
            driver.findElement(By.id("username")).sendKeys("customer01");
            driver.findElement(By.id("password")).sendKeys("wrongpass");
            driver.findElement(By.id("role")).sendKeys("一般顧客");
            driver.findElement(By.cssSelector("button[type='submit']")).click();

            // エラーメッセージ待機
            wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("loginError")));
            String error = driver.findElement(By.id("loginError")).getText();
            if (i < 2) {
                Assertions.assertTrue(error.contains("認証失敗"));
            }
        }

        // 3回目後のロックメッセージ確認
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("loginError")));
        String lockError = driver.findElement(By.id("loginError")).getText();
        Assertions.assertTrue(lockError.contains("ログイン試行回数超過"));

        // ロック中の再試行
        driver.findElement(By.id("username")).clear();
        driver.findElement(By.id("password")).clear();
        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        driver.findElement(By.id("role")).sendKeys("一般顧客");
        driver.findElement(By.cssSelector("button[type='submit']")).click();

        // ロック中メッセージ確認
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("loginError")));
        String retryError = driver.findElement(By.id("loginError")).getText();
        Assertions.assertTrue(retryError.contains("アカウントがロックされています"));
    }

    @Test
    void testMFAFailure() {
        driver.get(System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:8080");

        // 基本認証成功
        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        driver.findElement(By.id("role")).sendKeys("一般顧客");
        driver.findElement(By.cssSelector("button[type='submit']")).click();

        // MFA画面待機
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("mfaScreen")));
        driver.findElement(By.id("mfaCode")).sendKeys("654321"); // 誤ったコード
        driver.findElement(By.cssSelector("button[type='submit']")).click();

        // MFA失敗メッセージ確認
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("mfaError")));
        String mfaError = driver.findElement(By.id("mfaError")).getText();
        Assertions.assertTrue(mfaError.contains("認証コードが正しくありません"));
    }
}
