import static org.junit.jupiter.api.Assertions.*;
import static org.openqa.selenium.By.*;
import static org.openqa.selenium.WebDriver.*;
import static org.openqa.selenium.WebElement.*;
import static org.openqa.selenium.support.ui.*;

import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.*;
import org.openqa.selenium.*;
import org.openqa.selenium.chrome.*;

public class LoginTest {

    private WebDriver driver;

    @BeforeEach
    public void setUp() {
        driver = new ChromeDriver();
        driver.manage().window().maximize();
        driver.manage().timeouts().implicitlyWait(30, TimeUnit.SECONDS);
        driver.get(System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:8080");
    }

    @AfterEach
    public void tearDown() {
        driver.quit();
    }

    @Test
    public void testNormalLogin() {
        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        driver.findElement(By.id("role")).sendKeys("一般顧客");
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();

        assertEquals("dashboard", driver.findElement(By.id("userName")).getText());
    }

    @Test
    public void testLoginWithMFA() {
        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        driver.findElement(By.id("role")).sendKeys("一般顧客");
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();

        assertEquals("123456", driver.findElement(By.id("mfaCode")).getAttribute("value"));
        driver.findElement(By.id("mfaCode")).sendKeys("123456");
        driver.findElement(By.xpath("//button[text()='認証']")).click();

        assertEquals("dashboard", driver.findElement(By.id("userName")).getText());
    }

    @Test
    public void testLoginWithFailedAttempts() {
        for (int i = 0; i < 3; i++) {
            driver.findElement(By.id("username")).sendKeys("customer01");
            driver.findElement(By.id("password")).sendKeys("wrongpass");
            driver.findElement(By.id("role")).sendKeys("一般顧客");
            driver.findElement(By.xpath("//button[text()='ログイン']")).click();

            assertEquals("認証失敗（残り1回）", driver.findElement(By.id("loginError")).getText());
        }

        assertEquals("アカウントがロックされています。残り30秒", driver.findElement(By.id("loginError")).getText());
    }
}
