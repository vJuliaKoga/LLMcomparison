import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.openqa.selenium.support.expectedLocations.ExpectedLocations;
import java.time.Duration;

public class SecureBankLoginTest {

    private WebDriver driver;

    @BeforeEach
    public void setUp() {
        // ChromeDriver の設定 (必要に応じてパスを指定)
        System.setProperty("webdriver.chrome.driver", "chromedriver");
        driver = new ChromeDriver();
        driver.manage().timeouts().implicitlyWait(Duration.ofSeconds(10));
    }

    @AfterEach
    public void tearDown() {
        driver.quit();
    }

    @Test
    public void testSuccessfulLogin() {
        String baseUrl = System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:8080";
        driver.get(baseUrl + "/loginScreen");

        // 入力
        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        driver.findElement(By.id("role")).click(); // 一般顧客を選択

        // 実行
        driver.findElement(By.id("submit_button")).click();

        // 検証
        WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));
        wait.until(ExpectedLocations.visibilityOfElementLocated(By.id("mfaScreen"))); // MFA画面遷移確認
        driver.findElement(By.id("mfaCode")).sendKeys("123456");
        driver.findElement(By.id("mfaSubmit")).click();

        wait.until(ExpectedLocations.visibilityOfElementLocated(By.id("dashboard"))); // ダッシュボード画面遷移確認
        driver.findElement(By.id("userName")).sendKeys("customer01");
        driver.findElement(By.id("accountNumber")).sendKeys("1234567890");
        driver.findElement(By.id("balance")).sendKeys("1500000");

    }

    @Test
    public void testLoginAttemptLimit() {
        String baseUrl = System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:8080";
        driver.get(baseUrl + "/loginScreen");

        // ログイン試行
        for (int i = 0; i < 4; i++) {
            driver.findElement(By.id("username")).sendKeys("customer01");
            driver.findElement(By.id("password")).sendKeys("pass123");
            driver.findElement(By.id("submit_button")).click();

            WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(5));
            wait.until(ExpectedLocations.visibilityOfElementLocated(By.id("loginError")));
            String errorMessage = driver.findElement(By.id("loginError")).getText();
            assert errorMessage.contains("認証失敗");
            driver.findElement(By.id("loginError")).clear();
        }

        // ログイン試行制限後の状態確認
        WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));
        wait.until(ExpectedLocations.visibilityOfElementLocated(By.id("loginError")));
        String errorMessage = driver.findElement(By.id("loginError")).getText();
        assert errorMessage.contains("アカウントがロックされています");

    }

    @Test
    public void testInvalidCredentials() {
        String baseUrl = System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:8080";
        driver.get(baseUrl + "/loginScreen");

        // 無効なユーザーIDとパスワードでログイン試行
        driver.findElement(By.id("username")).sendKeys("invalidUser");
        driver.findElement(By.id("password")).sendKeys("invalidPassword");
        driver.findElement(By.id("submit_button")).click();

        // 検証
        WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(5));
        wait.until(ExpectedLocations.visibilityOfElementLocated(By.id("loginError")));
        String errorMessage = driver.findElement(By.id("loginError")).getText();
        assert errorMessage.contains("⚠️ ユーザーIDとパスワードを入力してください");
    }
}
