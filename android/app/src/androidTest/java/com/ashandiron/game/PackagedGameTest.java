package com.ashandiron.game;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.pressBack;
import static androidx.test.espresso.matcher.ViewMatchers.isRoot;

import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PackagedGameTest {
    private static final String TICK =
        "(JSON.parse(localStorage.getItem('ash-and-iron-solo'))?.save?.match?.tick ?? 0)";

    @Test
    public void bundledSoloPausesAndResumesFromDisk() throws Exception {
        try (ActivityScenario<MainActivity> app = ActivityScenario.launch(MainActivity.class)) {
            waitFor(app, "document.documentElement.classList.contains('native-app')");
            assertEquals("\"https://app.ashandiron.localhost\"", evaluate(app, "location.origin"));
            waitFor(app, "document.querySelector('#connection').dataset.state === 'idle'");
            assertEquals("false", evaluate(app, "document.querySelector('#create').disabled"));
            app.moveToState(Lifecycle.State.CREATED);
            app.moveToState(Lifecycle.State.RESUMED);
            waitFor(app, "document.querySelector('#connection').dataset.state === 'idle' && !document.querySelector('#create').disabled");
            evaluate(app, "() => { document.querySelector('#solo').click() }");
            waitFor(app, "!!document.querySelector('#battlefield canvas') && " + TICK + " > 0");
            evaluate(app, "() => { document.querySelector('#match-options').click() }");
            waitFor(app, "document.querySelector('#match-options-sheet').open");
            onView(isRoot()).perform(pressBack());
            waitFor(app, "!document.querySelector('#match-options-sheet').open");
            assertEquals("true", evaluate(app, "!!document.querySelector('#battlefield canvas')"));
            evaluate(app, "() => { document.querySelector('#solo-pause').click() }");
            waitFor(app, "document.querySelector('#solo-pause').textContent === 'Resume'");
            app.moveToState(Lifecycle.State.CREATED);
            app.moveToState(Lifecycle.State.RESUMED);
            waitFor(app, "document.querySelector('#solo-pause').textContent === 'Resume'");
            Thread.sleep(300);
            String checkpoint = evaluate(app, TICK);
            Thread.sleep(1200);
            assertEquals(checkpoint, evaluate(app, TICK));
            evaluate(app, "() => { document.querySelector('#solo-pause').click() }");
            waitFor(app, TICK + " > " + checkpoint);
        }
        try (ActivityScenario<MainActivity> app = ActivityScenario.launch(MainActivity.class)) {
            waitFor(app, "document.querySelector('#solo')?.textContent === 'Resume solo match'");
            evaluate(app, "() => { document.querySelector('#solo').click() }");
            waitFor(app, "!!document.querySelector('#battlefield canvas') && " + TICK + " > 0");
        }
    }

    private static String evaluate(ActivityScenario<MainActivity> app, String expression) throws Exception {
        String script = expression.startsWith("() =>") ? "(" + expression + ")()" : expression;
        CompletableFuture<String> result = new CompletableFuture<>();
        app.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, result::complete));
        try {
            return result.get(15, TimeUnit.SECONDS);
        } catch (TimeoutException timeout) {
            throw new AssertionError("WebView did not evaluate: " + expression, timeout);
        }
    }

    private static void waitFor(ActivityScenario<MainActivity> app, String expression) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(35);
        while (System.nanoTime() < deadline) {
            if ("true".equals(evaluate(app, expression))) return;
            Thread.sleep(100);
        }
        assertTrue(expression, false);
    }
}
