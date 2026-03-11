import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import static org.junit.jupiter.api.Assertions.assertTrue;

public class AuditLogTest {
    private WebDriver driver;
    private WebDriverWait wait;

    @BeforeEach
    void setup() {
        System.setProperty("webdriver.chrome.driver", "/path/to/chromedriver");
        driver = new ChromeDriver();
        wait = new WebDriverWait(driver, 10);
        driver.get(System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:8080");
    }

    @AfterEach
    void tearDown() {
        driver.quit();
    }

    @Test
    void testAdminCanSeeAuditLog() {
        // ログイン
        driver.findElement(By.id("username")).sendKeys("admin01");
        driver.findElement(By.id("password")).sendKeys("admin123");
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();

        // 監査ログタブが表示される
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("auditTab")));
        assertTrue(driver.findElement(By.id("auditTab")).isDisplayed());
    }

    @Test
    void testCustomerCannotSeeAuditLog() {
        // ログイン
        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();

        // 監査ログタブが非表示
        wait.until(ExpectedConditions.invisibilityOfElementLocated(By.id("auditTab")));
        assertTrue(driver.findElements(By.id("auditTab")).isEmpty());
    }

    @Test
    void testAuditLogIsSortedByTimestamp() {
        // ログイン
        driver.findElement(By.id("username")).sendKeys("admin01");
        driver.findElement(By.id("password")).sendKeys("admin123");
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();

        // 監査ログタブをクリック
        driver.findElement(By.id("auditTab")).click();

        // 監査ログ一覧が最新順に表示される
        wait.until(ExpectedConditions.visibilityOfAllElementsLocatedBy(By.cssSelector("#auditLog tr")));
        WebElement firstLog = driver.findElement(By.cssSelector("#auditLog tr:first-child"));
        WebElement lastLog = driver.findElement(By.cssSelector("#auditLog tr:last-child"));
        assertTrue(firstLog.findElement(By.cssSelector("td:first-child")).getText().compareTo(lastLog.findElement(By.cssSelector("td:first-child")).getText()) > 0);
    }
}
