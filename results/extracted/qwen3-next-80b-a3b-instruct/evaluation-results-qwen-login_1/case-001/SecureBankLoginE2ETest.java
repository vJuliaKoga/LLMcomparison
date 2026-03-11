import org.junit.jupiter.api.*;
import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import java.time.Duration;
import java.util.NoSuchElementException;

import static org.junit.jupiter.api.Assertions.*;

public class SecureBankLoginE2ETest {

    private WebDriver driver;
    private WebDriverWait wait;
    private final String baseUrl = System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:8080";

    @BeforeEach
    void setUp() {
        System.setProperty("webdriver.chrome.driver", "chromedriver");
        driver = new ChromeDriver();
        wait = new WebDriverWait(driver, Duration.ofSeconds(10));
        driver.manage().window().maximize();
    }

    @AfterEach
    void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }

    @Test
    void 正常系_一般顧客が正しい認証情報とMFAでログイン成功する() {
        driver.get(baseUrl + "#loginScreen");

        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        Select roleSelect = new Select(driver.findElement(By.id("role")));
        roleSelect.selectByValue("customer");
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("mfaScreen")));
        driver.findElement(By.id("mfaCode")).sendKeys("123456");
        driver.findElement(By.xpath("//button[text()='認証']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("dashboard")));
        assertTrue(driver.findElement(By.id("dashboard")).isDisplayed());
        assertEquals("一般顧客", driver.findElement(By.id("roleBadge")).getText());
    }

    @Test
    void 異常系_認証失敗3回でアカウントがロックされる() {
        driver.get(baseUrl + "#loginScreen");

        for (int i = 0; i < 3; i++) {
            driver.findElement(By.id("username")).clear();
            driver.findElement(By.id("password")).clear();
            driver.findElement(By.id("username")).sendKeys("customer01");
            driver.findElement(By.id("password")).sendKeys("wrongpass");
            driver.findElement(By.xpath("//button[text()='ログイン']")).click();

            if (i < 2) {
                String errorMsg = wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("loginError"))).getText();
                assertTrue(errorMsg.matches("❌ 認証失敗（残り\\d回）"));
            } else {
                String errorMsg = wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("loginError"))).getText();
                assertEquals("🔒 ログイン試行回数超過。30秒間ロックされます", errorMsg);
            }
        }

        // ロック中にもう1回試行
        driver.findElement(By.id("username")).clear();
        driver.findElement(By.id("password")).clear();
        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();

        String lockMsg = wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("loginError"))).getText();
        assertTrue(lockMsg.matches("🔒 アカウントがロックされています。残り\\d秒"));
    }

    @Test
    void 異常系_MFA認証コードが不正でログイン失敗する() {
        driver.get(baseUrl + "#loginScreen");

        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        Select roleSelect = new Select(driver.findElement(By.id("role")));
        roleSelect.selectByValue("customer");
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("mfaScreen")));
        driver.findElement(By.id("mfaCode")).sendKeys("000000");
        driver.findElement(By.xpath("//button[text()='認証']")).click();

        String mfaError = wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("mfaError"))).getText();
        assertEquals("❌ 認証コードが正しくありません", mfaError);
        assertTrue(driver.findElement(By.id("mfaScreen")).isDisplayed());
    }
}
