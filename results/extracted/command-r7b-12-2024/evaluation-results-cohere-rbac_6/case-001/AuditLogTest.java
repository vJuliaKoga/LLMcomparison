import static org.junit.jupiter.api.Assertions.*;
import static org.openqa.selenium.By.id;
import static org.openqa.selenium.By.xpath;
import static org.openqa.selenium.WebDriver.*;
import static org.openqa.selenium.WebElement.*;
import static org.openqa.selenium.support.ui.ExpectedConditions.*;
import static org.openqa.selenium.support.ui.WebDriverWait.*;

import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;

public class AuditLogTest {

    private ChromeDriver driver;

    @BeforeEach
    public void setUp() {
        System.setProperty("webdriver.chrome.driver", "path/to/chromedriver");
        ChromeOptions options = new ChromeOptions();
        driver = new ChromeDriver(options);
        driver.manage().window().maximize();
        driver.get("http://localhost:8080");
    }

    @AfterEach
    public void tearDown() {
        driver.quit();
    }

    @Test
    public void testAdminAuditLog() {
        // ログイン（管理者）
        driver.findElement(id("username")).sendKeys("admin01");
        driver.findElement(id("password")).sendKeys("admin123");
        driver.findElement(id("role")).sendKeys("admin");
        driver.findElement(id("login")).click();

        // 監査ログタブをクリック
        driver.findElement(xpath("//a[text()='監査ログ']")).click();

        // 監査ログが表示されることを確認
        List<WebElement> logEntries = driver.findElements(id("auditLog"));
        assertEquals(3, logEntries.size()); // 例: 3つのログエントリがあることを確認
    }

    @Test
    public void testCustomerAuditLog() {
        // ログイン（一般顧客）
        driver.findElement(id("username")).sendKeys("customer01");
        driver.findElement(id("password")).sendKeys("pass123");
        driver.findElement(id("role")).sendKeys("customer");
        driver.findElement(id("login")).click();

        // 監査ログタブが非表示であることを確認
        assertFalse(driver.findElement(id("auditTab")).isDisplayed());
    }

    @Test
    public void testAuditorAuditLog() {
        // ログイン（監査者）
        driver.findElement(id("username")).sendKeys("auditor01");
        driver.findElement(id("password")).sendKeys("audit123");
        driver.findElement(id("role")).sendKeys("auditor");
        driver.findElement(id("login")).click();

        // 監査ログタブが表示されることを確認
        assertTrue(driver.findElement(id("auditTab")).isDisplayed());

        // 監査ログが表示されることを確認
        List<WebElement> logEntries = driver.findElements(id("auditLog"));
        assertEquals(3, logEntries.size()); // 例: 3つのログエントリがあることを確認
    }
}
