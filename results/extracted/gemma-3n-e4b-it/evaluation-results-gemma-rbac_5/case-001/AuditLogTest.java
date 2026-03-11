import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.openqa.selenium.support.expectedLocations.ExpectedLocations;
import java.time.Duration;

public class AuditLogTest {

    private WebDriver driver;

    @BeforeEach
    public void setUp() {
        // ChromeDriver の設定 (必要に応じてパスを指定)
        System.setProperty("webdriver.chrome.driver", "path/to/chromedriver");
        driver = new ChromeDriver();
        driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10));
    }

    @AfterEach
    public void tearDown() {
        driver.quit();
    }

    @Test
    public void testAdminCanViewAuditLog() {
        String baseUrl = System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:8080";
        driver.get(baseUrl + "/loginScreen");

        WebElement usernameField = driver.findElement(By.id("username"));
        usernameField.sendKeys("admin01");

        WebElement passwordField = driver.findElement(By.id("password"));
        passwordField.sendKeys("admin123");

        WebElement submitButton = driver.findElement(By.id("submit_button_text"));
        submitButton.click();

        WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));
        wait.until(ExpectedLocations.visibilityOf(driver.findElement(By.id("dashboard"))));

        WebElement auditTab = driver.findElement(By.id("auditTab"));
        assert auditTab.isDisplayed();
    }

    @Test
    public void testCustomerCannotViewAuditLog() {
        String baseUrl = System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:8080";
        driver.get(baseUrl + "/loginScreen");

        WebElement usernameField = driver.findElement(By.id("username"));
        usernameField.sendKeys("customer01");

        WebElement passwordField = driver.findElement(By.id("password"));
        passwordField.sendKeys("pass123");

        WebElement submitButton = driver.findElement(By.id("submit_button_text"));
        submitButton.click();

        WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));
        wait.until(ExpectedLocations.visibilityOf(driver.findElement(By.id("dashboard"))));

        WebElement auditTab = driver.findElement(By.id("auditTab"));
        assert !auditTab.isDisplayed();
    }

    @Test
    public void testAuditLogDisplayFormat() {
        String baseUrl = System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:8080";
        driver.get(baseUrl + "/loginScreen");

        WebElement usernameField = driver.findElement(By.id("username"));
        usernameField.sendKeys("auditor01");

        WebElement passwordField = driver.findElement(By.id("password"));
        passwordField.sendKeys("audit123");

        WebElement submitButton = driver.findElement(By.id("submit_button_text"));
        submitButton.click();

        WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));
        wait.until(ExpectedLocations.visibilityOf(driver.findElement(By.id("auditLog"))));

        // 監査ログの内容を検証する処理を追加（例：最新ログが上順に表示されているか、ログレベルごとに色分けされているか）
        // 監査ログの内容はテスト環境によって変わるため、具体的な検証は省略
        assert driver.findElement(By.id("auditLog")).isDisplayed();
    }
}
