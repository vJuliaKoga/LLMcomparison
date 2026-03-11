import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class TransferTest {
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
    void testNormalTransfer() {
        // ログイン
        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();

        // 振込タブに移動
        driver.findElement(By.id("tabTransfer")).click();

        // 入力
        driver.findElement(By.id("transferTo")).sendKeys("9876543210");
        driver.findElement(By.id("transferAmount")).sendKeys("1000");
        driver.findElement(By.id("transferMemo")).sendKeys("テスト");

        // 振込実行
        driver.findElement(By.xpath("//button[text()='振込']")).click();

        // 成功メッセージ表示
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("transferMessage")));
        assertEquals("✅ 振込が完了しました", driver.findElement(By.id("transferMessage")).getText());
    }

    @Test
    void testInvalidAccountNumber() {
        // ログイン
        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();

        // 振込タブに移動
        driver.findElement(By.id("tabTransfer")).click();

        // 入力
        driver.findElement(By.id("transferTo")).sendKeys("123456789"); // 10桁未満
        driver.findElement(By.id("transferAmount")).sendKeys("1000");
        driver.findElement(By.id("transferMemo")).sendKeys("テスト");

        // 振込実行
        driver.findElement(By.xpath("//button[text()='振込']")).click();

        // エラーメッセージ表示
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("transferMessage")));
        assertEquals("❌ 振込先口座番号は10桁の数字で入力してください", driver.findElement(By.id("transferMessage")).getText());
    }

    @Test
    void testInsufficientBalance() {
        // ログイン
        driver.findElement(By.id("username")).sendKeys("customer01");
        driver.findElement(By.id("password")).sendKeys("pass123");
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();

        // 振込タブに移動
        driver.findElement(By.id("tabTransfer")).click();

        // 入力
        driver.findElement(By.id("transferTo")).sendKeys("9876543210");
        driver.findElement(By.id("transferAmount")).sendKeys("1500001"); // 残高を超える金額
        driver.findElement(By.id("transferMemo")).sendKeys("テスト");

        // 振込実行
        driver.findElement(By.xpath("//button[text()='振込']")).click();

        // エラーメッセージ表示
        wait.until(ExpectedConditions.visibilityOfElementLocated(By.id("transferMessage")));
        assertEquals("❌ 残高不足です", driver.findElement(By.id("transferMessage")).getText());
    }
}
