import static org.junit.jupiter.api.Assertions.*;
import static org.openqa.selenium.By.*;
import static org.openqa.selenium.WebDriver.*;
import static org.openqa.selenium.WebElement.*;
import static org.openqa.selenium.interactions.Actions.*;
import java.util.List;
import org.junit.jupiter.api.*;
import org.openqa.selenium.*;
import org.openqa.selenium.chrome.*;
import org.openqa.selenium.support.ui.*;

public class TransferTest {

    private WebDriver driver;
    private String baseUrl = System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:8080";

    @BeforeEach
    public void setUp() {
        driver = new ChromeDriver();
        driver.get(baseUrl);
    }

    @AfterEach
    public void tearDown() {
        driver.quit();
    }

    @Test
    public void testNormalTransfer() {
        // ログイン
        login("customer01", "pass123");

        // 振込タブを開く
        switchToTab("transfer");

        // 振込先口座番号を入力
        driver.findElement(By.id("transferTo")).sendKeys("1234567890");

        // 振込金額を入力
        driver.findElement(By.id("transferAmount")).sendKeys("100000");

        // メモを入力
        driver.findElement(By.id("transferMemo")).sendKeys("テスト振込");

        // 振込実行
        driver.findElement(By.xpath("//button[text()='振込']")).click();

        // 成功メッセージを確認
        assertEquals("✅ 振込が完了しました", driver.findElement(By.id("transferMessage")).getText());

        // 残高が更新されていることを確認
        assertEquals("¥1,400,000", driver.findElement(By.id("balance")).getText());

        // 取引履歴が表示されていることを確認
        List<WebElement> transactionList = driver.findElements(By.id("transactionList"));
        assertEquals(1, transactionList.size());
        assertEquals("振込", transactionList.get(0).getText());
    }

    @Test
    public void testInvalidAccountNumber() {
        // ログイン
        login("customer01", "pass123");

        // 振込タブを開く
        switchToTab("transfer");

        // 振込先口座番号を入力
        driver.findElement(By.id("transferTo")).sendKeys("123456789");

        // 振込実行
        driver.findElement(By.xpath("//button[text()='振込']")).click();

        // エラーメッセージを確認
        assertEquals("❌ 振込先口座番号は10桁の数字で入力してください", driver.findElement(By.id("transferMessage")).getText());
    }

    private void login(String username, String password) {
        driver.findElement(By.id("username")).sendKeys(username);
        driver.findElement(By.id("password")).sendKeys(password);
        driver.findElement(By.xpath("//button[text()='ログイン']")).click();
    }

    private void switchToTab(String tabName) {
        driver.findElement(By.xpath("//a[text()='" + tabName + "']")).click();
    }
}
