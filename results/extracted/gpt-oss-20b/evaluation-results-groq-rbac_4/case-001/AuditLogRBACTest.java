import org.junit.jupiter.api.*;
import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.*;

import java.time.Duration;
import java.util.List;

@TestInstance(TestInstance.Lifecycle.PER_METHOD)
public class AuditLogRBACTest {

    private WebDriver driver;
    private WebDriverWait wait;
    private static final String BASE_URL = System.getenv().getOrDefault("BASE_URL", "http://localhost:8080");

    @BeforeEach
    void setUp() {
        // System.setProperty("webdriver.chrome.driver", "/path/to/chromedriver");
        driver = new ChromeDriver();
        driver.manage().window().maximize();
        wait = new WebDriverWait(driver, Duration.ofSeconds(10));
        driver.get(BASE_URL);
    }

    @AfterEach
    void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }

    private void login(String username, String password, String role) {
        // Fill login form
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("username"))).sendKeys(username);
        driver.findElement(By.id("password")).sendKeys(password);
        driver.findElement(By.id("role")).sendKeys(role);

        // Submit
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();

        // Wait for MFA screen
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("mfaScreen")));

        // Enter MFA code
        driver.findElement(By.id("mfaCode")).sendKeys("123456");
        driver.findElement(By.xpath("//button[text()='認証']")).click();

        // Wait for dashboard
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("dashboard")));
    }

    @Test
    void adminCanViewAuditLog() {
        login("admin01", "admin123", "admin");

        // Click audit tab
        WebElement auditTab = wait.until(ExpectedConditions.elementToBeClickable(By.id("auditTab")));
        auditTab.click();

        // Verify audit log container is displayed
        WebElement auditLog = wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("auditLog")));
        Assertions.assertTrue(auditLog.isDisplayed(), "Audit log container should be visible for admin");

        // Optional: check that at least one log entry exists
        List<WebElement> entries = auditLog.findElements(By.cssSelector(".logEntry"));
        Assertions.assertFalse(entries.isEmpty(), "Audit log should contain at least one entry");
    }

    @Test
    void customerCannotSeeAuditTab() {
        login("customer01", "pass123", "customer");

        // Verify audit tab is not present
        List<WebElement> auditTabs = driver.findElements(By.id("auditTab"));
        Assertions.assertTrue(auditTabs.isEmpty() || !auditTabs.get(0).isDisplayed(),
                "Audit tab should not be visible for general customers");
    }

    @Test
    void auditorCanViewAuditLog() {
        login("auditor01", "audit123", "auditor");

        // Click audit tab
        WebElement auditTab = wait.until(ExpectedConditions.elementToBeClickable(By.id("auditTab")));
        auditTab.click();

        // Verify audit log container is displayed
        WebElement auditLog = wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("auditLog")));
        Assertions.assertTrue(auditLog.isDisplayed(), "Audit log container should be visible for auditor");

        // Optional: check that at least one log entry exists
        List<WebElement> entries = auditLog.findElements(By.cssSelector(".logEntry"));
        Assertions.assertFalse(entries.isEmpty(), "Audit log should contain at least one entry");
    }
}
