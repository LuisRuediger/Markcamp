package com.markcamp.backend.common;

import java.time.Clock;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class ClockConfig {

	// A bean, never Instant.now() directly, so time-based rules can be unit-tested with Clock.fixed.
	@Bean
	Clock clock() {
		return Clock.systemUTC();
	}

}
