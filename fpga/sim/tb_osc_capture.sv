`timescale 1ns/1ps

module tb_osc_capture;
    localparam int SAMPLE_WIDTH = 8;
    localparam int ADDR_WIDTH   = 4; // 16 samples

    logic clk = 1'b0;
    always #5 clk = ~clk;

    logic rst = 1'b1;
    logic [SAMPLE_WIDTH-1:0] sample_data;
    logic sample_valid;
    logic arm, abort;
    logic trigger_enable, trigger_rising;
    logic [SAMPLE_WIDTH-1:0] trigger_level;
    logic [ADDR_WIDTH:0] pretrigger_count, posttrigger_count;
    logic busy, triggered, done;
    logic [ADDR_WIDTH:0] capture_length;
    logic [ADDR_WIDTH:0] read_index;
    logic [SAMPLE_WIDTH-1:0] read_data;
    logic read_valid;

    osc_capture #(
        .SAMPLE_WIDTH(SAMPLE_WIDTH),
        .ADDR_WIDTH(ADDR_WIDTH)
    ) dut (.*);

    task automatic send_sample(input logic [SAMPLE_WIDTH-1:0] value);
        begin
            @(negedge clk);
            sample_data  = value;
            sample_valid = 1'b1;
            @(negedge clk);
            sample_valid = 1'b0;
        end
    endtask

    initial begin
        sample_data       = '0;
        sample_valid      = 1'b0;
        arm               = 1'b0;
        abort             = 1'b0;
        trigger_enable    = 1'b1;
        trigger_rising    = 1'b1;
        trigger_level     = 8'd128;
        pretrigger_count  = 5;
        posttrigger_count = 4;

        repeat (2) @(posedge clk);
        rst = 1'b0;

        @(negedge clk);
        arm = 1'b1;
        @(negedge clk);
        arm = 1'b0;

        // Five samples below threshold, then a rising edge, then samples.
        send_sample(8'd10);
        send_sample(8'd20);
        send_sample(8'd30);
        send_sample(8'd40);
        send_sample(8'd50);
        send_sample(8'd200); // trigger sample
        send_sample(8'd201);
        send_sample(8'd202);
        send_sample(8'd203);

        @(posedge clk);
        if (!done) $fatal("capture did not complete");
        if (capture_length != 9) $fatal("unexpected capture length");

        // The first five entries are the pre-trigger samples and the sixth
        // entry is the trigger sample.
        for (int i = 0; i < 9; i++) begin
            read_index = i;
            #1;
            if (!read_valid) $fatal("read %0d was invalid", i);
            $display("capture[%0d] = %0d", i, read_data);
        end

        $display("PASS");
        $finish;
    end
endmodule
