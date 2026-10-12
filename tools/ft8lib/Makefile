# Builds the vector generator against the ft8_lib checkout in src/. Run through build.sh.
SRC     = src
OUT     = $(SRC)/.rr73
CFLAGS  = -O2 -std=c11 -Wall -Wextra -Wno-unused-parameter -I$(SRC)
LDLIBS  = -lm
FFT_SRC = $(SRC)/fft/kiss_fft.c $(SRC)/fft/kiss_fftr.c

all: $(OUT)/vectors

$(OUT)/vectors: vectors.c $(SRC)/libft8.a $(FFT_SRC)
	@mkdir -p $(OUT)
	$(CC) $(CFLAGS) -o $@ vectors.c $(FFT_SRC) $(SRC)/libft8.a $(LDLIBS)

clean:
	rm -rf $(OUT)

.PHONY: all clean
