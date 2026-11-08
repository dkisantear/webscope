// SPI mode-0 configuration/status interface.
//
// Frame format, MSB first:
//   byte 0: [7] = 0 for write, 1 for read; [6:0] = register address
//   byte 1: reserved/address extension (send 0)
//   bytes 2-5: 32-bit data, MSB first
//
// A write always consists of 6 bytes. A read uses the same 6-byte frame;
// bytes 0 and 1 select the register, and bytes 2-5 are dummy MOSI bytes while
// the FPGA returns the 32-bit register value on MISO.
//
// SPI mode 0:
//   MOSI is sampled on rising SCLK edges.
//   MISO changes on falling SCLK edges.

module spi_config_slave (
    input  logic        rst,
    input  logic        spi_sclk,
    input  logic        spi_cs_n,
    input  logic        spi_mosi,
    output logic        spi_miso,

    // Configuration values remain stable until overwritten by SPI.
    output logic [11:0] cfg_trigger_level,
    output logic        cfg_trigger_enable,
    output logic        cfg_trigger_rising,
    output logic [31:0] cfg_pretrigger_count,
    output logic [31:0] cfg_posttrigger_count,
    output logic [31:0] cfg_sample_rate,

    // Toggle events cross from the SPI clock domain into the system clock
    // domain. The system side detects a change rather than relying on pulse
    // width.
    output logic        cfg_arm_toggle,
    output logic        cfg_abort_toggle,
    output logic        cfg_clear_toggle,

    // Status values are supplied by the system clock domain.
    input  logic        status_busy,
    input  logic        status_triggered,
    input  logic        status_done,
    input  logic [31:0] status_capture_length
);

    logic [7:0]  rx_shift;
    logic [7:0]  register_address;
    logic [31:0] write_shift;
    logic [31:0] tx_shift;
    logic [7:0]  bit_count;
    logic        read_transaction;

    logic [31:0] selected_read_value;
    wire [7:0] received_byte = {rx_shift[6:0], spi_mosi};
    wire [31:0] received_word = {write_shift[30:0], spi_mosi};
    wire write_commit = !spi_cs_n && (bit_count == 8'd47) &&
                        !read_transaction;

    always_comb begin
        selected_read_value = 32'h0000_0000;
        case (register_address)
            8'h00: begin
                selected_read_value = 32'h0000_0000;
                selected_read_value[0] = status_busy;
                selected_read_value[1] = status_triggered;
                selected_read_value[2] = status_done;
            end
            8'h02: selected_read_value = {20'd0, cfg_trigger_level};
            8'h03: selected_read_value = {30'd0, cfg_trigger_rising,
                                           cfg_trigger_enable};
            8'h04: selected_read_value = cfg_pretrigger_count;
            8'h05: selected_read_value = cfg_posttrigger_count;
            8'h06: selected_read_value = cfg_sample_rate;
            8'h07: selected_read_value = status_capture_length;
            8'h08: selected_read_value = 32'h0000_000C; // 12-bit ADC samples
            default: selected_read_value = 32'h0000_0000;
        endcase
    end

    // Receive bytes. CS is included as an asynchronous transaction reset so a
    // transaction does not depend on extra clocks while chip select is
    // inactive.
    always_ff @(posedge spi_sclk or posedge rst or posedge spi_cs_n) begin
        if (rst) begin
            rx_shift             <= 8'd0;
            register_address     <= 8'd0;
            write_shift          <= 32'd0;
            bit_count             <= 8'd0;
            read_transaction     <= 1'b0;
        end else if (spi_cs_n) begin
            // Start of the next assertion of CS.
            rx_shift         <= 8'd0;
            register_address <= 8'd0;
            write_shift      <= 32'd0;
            bit_count        <= 8'd0;
            read_transaction <= 1'b0;
        end else begin
            rx_shift <= {rx_shift[6:0], spi_mosi};
            bit_count <= bit_count + 1'b1;

            if (bit_count == 8'd7) begin
                // Header: bit 7 selects read/write; lower seven bits are
                // currently the register address.
                register_address <= {1'b0, received_byte[6:0]};
                read_transaction <= received_byte[7];
            end else if (bit_count == 8'd15) begin
                // The second byte is reserved for future address expansion.
                // It is still consumed so every frame is a fixed six bytes.
            end else if (bit_count >= 8'd16 && bit_count <= 8'd47) begin
                write_shift <= {write_shift[30:0], spi_mosi};

            end
        end
    end

    // Configuration registers have only a normal SPI-clock reset. They hold
    // their values between transactions when CS is inactive.
    always_ff @(posedge spi_sclk or posedge rst) begin
        if (rst) begin
            cfg_trigger_level     <= 12'd0;
            cfg_trigger_enable    <= 1'b0;
            cfg_trigger_rising    <= 1'b1;
            cfg_pretrigger_count  <= 32'd0;
            cfg_posttrigger_count <= 32'd1;
            cfg_sample_rate       <= 32'd0;
            cfg_arm_toggle        <= 1'b0;
            cfg_abort_toggle      <= 1'b0;
            cfg_clear_toggle      <= 1'b0;
        end else if (write_commit) begin
            case (register_address)
                8'h01: begin
                    if (received_word[0]) cfg_arm_toggle <= ~cfg_arm_toggle;
                    if (received_word[1]) cfg_abort_toggle <= ~cfg_abort_toggle;
                    if (received_word[2]) cfg_clear_toggle <= ~cfg_clear_toggle;
                end
                8'h02: cfg_trigger_level <= received_word[11:0];
                8'h03: begin
                    cfg_trigger_enable <= received_word[0];
                    cfg_trigger_rising <= received_word[1];
                end
                8'h04: cfg_pretrigger_count <= received_word;
                8'h05: cfg_posttrigger_count <= received_word;
                8'h06: cfg_sample_rate <= received_word;
                default: begin end
            endcase
        end
    end

    // Transmit path for mode 0. After the address bytes have arrived, the
    // first read bit is presented before the next rising SCLK edge.
    always_ff @(negedge spi_sclk or posedge rst or posedge spi_cs_n) begin
        if (rst) begin
            tx_shift  <= 32'd0;
            spi_miso  <= 1'b0;
        end else if (spi_cs_n) begin
            tx_shift  <= 32'd0;
            spi_miso  <= 1'b0;
        end else if (bit_count == 8'd16 && read_transaction) begin
            tx_shift <= {selected_read_value[30:0], 1'b0};
            spi_miso <= selected_read_value[31];
        end else if (bit_count > 8'd16 && bit_count <= 8'd48) begin
            spi_miso <= tx_shift[31];
            tx_shift <= {tx_shift[30:0], 1'b0};
        end else begin
            spi_miso <= 1'b0;
        end
    end

endmodule
