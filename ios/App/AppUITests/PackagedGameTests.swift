import XCTest

final class PackagedGameTests: XCTestCase {
    func testSoloWithNoBackendAndResumeAfterRestart() {
        let app = XCUIApplication()
        app.launch()
        let start = app.buttons["Play vs Computer"]
        XCTAssertTrue(start.waitForExistence(timeout: 20))
        start.tap()

        let pause = app.buttons["Pause"]
        XCTAssertTrue(pause.waitForExistence(timeout: 20))
        pause.tap()
        let resume = app.buttons["Resume"]
        XCTAssertTrue(resume.waitForExistence(timeout: 5))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(resume.waitForExistence(timeout: 5))
        resume.tap()
        XCTAssertTrue(pause.waitForExistence(timeout: 5))

        app.terminate()
        app.launch()
        let saved = app.buttons["Resume solo match"]
        XCTAssertTrue(saved.waitForExistence(timeout: 20))
        saved.tap()
        XCTAssertTrue(pause.waitForExistence(timeout: 20))
    }
}
