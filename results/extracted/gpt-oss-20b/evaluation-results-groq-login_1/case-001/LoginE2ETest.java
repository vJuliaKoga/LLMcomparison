import org.junit.jupiter.api.*;
import org.openqa.selenium.*;
import org.openqa.selenium.chrome.*;
import org.openqa.selenium.support.ui.*;

import java.time.Duration;
import java.util.List;

@TestInstance(TestInstance.Lifecycle.PER_METHOD)
public class LoginE2ETest {

    private WebDriver driver;
    private WebDriverWait wait;
    private String baseUrl;

    @BeforeEach
    void setUp() {
        // ChromeDriver executable must be on PATH or set via System.setProperty
        driver = new ChromeDriver();
        driver.manage().window().maximize();
        baseUrl = System.getenv("BASE_URL");
        if (baseUrl == null || baseUrl.isEmpty()) {
            baseUrl = "http://localhost:8080";
        }
        driver.get(baseUrl);
        wait = new WebDriverWait(driver, Duration.ofSeconds(10));
    }

    @AfterEach
    void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }

    // Helper to perform basic login
    private void performLogin(String username, String password, String role) {
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector("#loginScreen")));

        WebElement userField = driver.findElement(By.cssSelector("#username"));
        WebElement passField = driver.findElement(By.cssSelector("#password"));
        WebElement roleSelect = driver.findElement(By.cssSelector("#role"));

        userField.clear();
        userField.sendKeys(username);
        passField.clear();
        passField.sendKeys(password);
        new org.openqa.selenium.support.ui.Select(roleSelect).selectByVisibleText(role);

        // Click the login button (text "ログイン")
        driver.findElement(By.xpath("//button[contains(text(),'ログイン')]")).click();
    }

    @Test
    void testSuccessfulLoginWithMFA() {
        performLogin("customer01", "pass123", "一般顧客");

        // Wait for MFA screen
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector("#mfaScreen")));

        WebElement mfaField = driver.findElement(By.cssSelector("#mfaCode"));
        mfaField.clear();
        mfaField.sendKeys("123456");

        // Click MFA submit button (text "認証")
        driver.findElement(By.xpath("//button[contains(text(),'認証')]")).click();

        // Dashboard should be visible after successful MFA
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector("#dashboard")));
        Assertions.assertTrue(driver.findElement(By.cssSelector("#dashboard")).isDisplayed(),
                "Dashboard should be displayed after successful login and MFA");
    }

    @Test
    void testLoginFailureWrongPassword() {
        performLogin("customer01", "wrongpass", "一般顧客");

        WebElement error = wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector("#loginError")));
        Assertions.assertTrue(error.getText().contains("❌ 認証失敗"),
                "Error message should indicate authentication failure");
    }

    @Test
    void testAccountLockAfterThreeFailures() {
        // First failure
        performLogin("customer01", "wrongpass", "一般顧客");
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector("#loginError")));

        // Second failure
        performLogin("customer01", "wrongpass", "一般顧客");
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector("#loginError")));

        // Third failure – should trigger lock
        performLogin("customer01", "wrongpass", "一般顧客");
        WebElement lockError = wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector("#loginError")));
        Assertions.assertTrue(lockError.getText().contains("🔒 アカウントがロックされています"),
                "After 3 failures, account should be locked");

        // Attempt during lock period
        performLogin("customer01", "pass123", "一般顧客");
        WebElement lockDuring = wait.until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector("#loginError")));
        Assertions.assertTrue(lockDuring.getText().contains("🔒 アカウントがロックされています"),
                "Login attempts during lock period should be rejected");
    }
}
