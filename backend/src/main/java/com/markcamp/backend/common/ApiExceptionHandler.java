package com.markcamp.backend.common;

import java.net.URI;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.TypeMismatchException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Builds every error response of the MVC layer (ADR 0006, rule 4). 401s never get here: they are produced by the
 * security filter chain, before the request reaches Spring MVC.
 */
@RestControllerAdvice
class ApiExceptionHandler extends ResponseEntityExceptionHandler {

	private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

	private static final URI BLANK_TYPE = URI.create("about:blank");

	@ExceptionHandler(ApiException.class)
	ResponseEntity<Object> handleApiException(ApiException ex, WebRequest request) {
		ProblemDetail problem = problem(ex.getStatus(), ex.getCode(), ex.getDetail(), request);
		if (ex instanceof RequestValidationException validation) {
			problem.setProperty("errors", validation.getInvalidFields());
		}
		return respond(ex, problem, new HttpHeaders(), ex.getStatus(), request);
	}

	// Includes escaped constraint violations (ADR 0006, rule 3): mapping them to a 4xx would misstate the cause.
	@ExceptionHandler(Exception.class)
	ResponseEntity<Object> handleUnexpected(Exception ex, WebRequest request) {
		return handleExceptionInternal(ex, null, new HttpHeaders(), HttpStatus.INTERNAL_SERVER_ERROR, request);
	}

	// Every framework exception in the parent class ends up here. The body it offers is discarded: its detail can
	// echo request input (ADR 0006, rule 1).
	@Override
	protected ResponseEntity<Object> handleExceptionInternal(Exception ex, Object body, HttpHeaders headers,
			HttpStatusCode statusCode, WebRequest request) {
		if (statusCode.is5xxServerError()) {
			log.error("Unhandled exception: path={}", path(request), ex);
			ProblemDetail problem = problem(HttpStatus.INTERNAL_SERVER_ERROR, ProblemCode.INTERNAL_ERROR,
					"An unexpected error occurred.", request);
			return respond(ex, problem, headers, HttpStatus.INTERNAL_SERVER_ERROR, request);
		}
		ProblemCode code = frameworkCode(ex);
		return respond(ex, problem(statusCode, code, frameworkDetail(code), request), headers, statusCode, request);
	}

	private ResponseEntity<Object> respond(Exception ex, ProblemDetail problem, HttpHeaders headers,
			HttpStatusCode statusCode, WebRequest request) {
		// Copied because the headers can belong to the exception. Set explicitly so that the Accept header of the
		// request cannot change the format of an error.
		HttpHeaders responseHeaders = HttpHeaders.copyOf(headers);
		responseHeaders.setContentType(MediaType.APPLICATION_PROBLEM_JSON);
		return super.handleExceptionInternal(ex, problem, responseHeaders, statusCode, request);
	}

	private static ProblemDetail problem(HttpStatusCode status, ProblemCode code, String detail, WebRequest request) {
		// The title defaults to the HTTP reason phrase. The type does not default: unset, it is left out of the JSON.
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
		problem.setType(BLANK_TYPE);
		problem.setInstance(URI.create(path(request)));
		problem.setProperty("code", code);
		return problem;
	}

	private static String path(WebRequest request) {
		return ((ServletWebRequest) request).getRequest().getRequestURI();
	}

	private static ProblemCode frameworkCode(Exception ex) {
		if (ex instanceof HttpMessageNotReadableException || ex instanceof TypeMismatchException) {
			return ProblemCode.MALFORMED_REQUEST;
		}
		if (ex instanceof NoResourceFoundException || ex instanceof NoHandlerFoundException) {
			return ProblemCode.RESOURCE_NOT_FOUND;
		}
		if (ex instanceof HttpRequestMethodNotSupportedException) {
			return ProblemCode.METHOD_NOT_ALLOWED;
		}
		if (ex instanceof HttpMediaTypeNotSupportedException) {
			return ProblemCode.UNSUPPORTED_MEDIA_TYPE;
		}
		return ProblemCode.INVALID_REQUEST;
	}

	private static String frameworkDetail(ProblemCode code) {
		return switch (code) {
			case MALFORMED_REQUEST -> "The request could not be read.";
			case RESOURCE_NOT_FOUND -> "No endpoint exists at this path.";
			case METHOD_NOT_ALLOWED -> "This HTTP method is not supported at this path.";
			case UNSUPPORTED_MEDIA_TYPE -> "This Content-Type is not supported.";
			default -> "The request is not valid.";
		};
	}

}
