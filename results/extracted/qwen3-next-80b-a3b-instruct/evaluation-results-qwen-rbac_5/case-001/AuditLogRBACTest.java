import org.junit.jupiter.api.*;
import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.openqa.selenium.support.ui.ExpectedConditions;

import java.time.Duration;
import java.util.Objects;

import static org.junit.jupiter.api.Assertions.*;

public class AuditLogRBACTest {

    private WebDriver driver;
    private WebDriverWait wait;

    @BeforeEach
    void setUp() {
        System.setProperty("webdriver.chrome.driver", "chromedriver");
        driver = new ChromeDriver();
        wait = new WebDriverWait(driver, Duration.ofSeconds(10));
        String baseUrl = Objects.requireNonNullElse(System.getenv("BASE_URL"), "http://localhost:8080");
        driver.get(baseUrl);
    }

    @AfterEach
    void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }

    @Test
    void admin_can_access_audit_log_tab() {
        driver.findElement(By.id("username")).sendKeys("admin01");
        driver.findElement(By.id("password")).sendKeys("admin123");
        driver.findElement(By.cssSelector("button[type='submit']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("mfaCode")));
        driver.findElement(By.id("mfaCode")).sendKeys("123456");
        driver.findElement(By.cssSelector("#mfaScreen button[type='submit']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("auditTab")));
        WebElement auditTab = driver.findElement(By.id("auditTab"));
        assertTrue(auditTab.isDisplayed(), "管理者は監査ログタブを表示すべき");
    }

    @Test
    void customer_cannot_see_audit_log_tab() {
        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        driver.findElement(By.cssSelector("button[type='submit']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("mfaCode")));
        driver.findElement(By.id("mfaCode")).sendKeys("123456");
        driver.findElement(By.cssSelector("#mfaScreen button[type='submit']")).click();

        wait.until(ExpectedConditions.presenceOfElementLocated(By.id("dashboard")));
        WebElement auditTab = driver.findElement(By.id("auditTab"));
        assertFalse(auditTab.isDisplayed(), "一般顧客は監査ログタブを非表示にするべき");
    }

    @Test
    void auditor_can_access_audit_log_tab() {
        driver.findElement(By.id("username")).sendKeys("auditor01");
        driver.findElement(By.id("password")).sendKeys("audit123");
        driver.findElement(By.cssSelector("button[type='submit']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("mfaCode")));
        driver.findElement(By.id("mfaCode")).sendKeys("123456");
        driver.findElement(By.cssSelector("#mfaScreen button[type='submit']")).click();

        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("auditTab")));
        WebElement auditTab = driver.findElement(By.id("auditTab"));
        assertTrue(auditTab.isDisplayed(), "監査者は監査ログタブを表示すべき");
    }
}
